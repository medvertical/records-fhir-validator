import type { StructureDefinition } from './structure-definition-types';
import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import type { ProfileSourcesConfig } from '../types';
import { logger } from '../logger';
import { loadFromLocalCache } from './sd-loader-filesystem';
import { isPackageAllowed } from './sd-loader-package-config';

export interface AutoDownloadContext {
  registryClient: PackageRegistryClient;
  packageDownloader: PackageDownloader;
  allowedPackages: string[];
  packageVersionPins?: Record<string, string>;
  packageSources: string[];
  cache: Map<string, StructureDefinition>;
  availableProfiles: Set<string>;
  /** Profile sources settings (optional - defaults to all enabled) */
  profileSourcesConfig?: ProfileSourcesConfig;
  /** FHIR version for package filtering (defaults to R4) */
  fhirVersion?: 'R4' | 'R5' | 'R6';
}

/** Default remote profile sources. Local cache and bundled profiles are always enabled. */
const DEFAULT_PROFILE_SOURCES: ProfileSourcesConfig = {
  simplifier: true,
  packageRegistry: true
};

function isCoreFhirStructureDefinition(url: string): boolean {
  return url.startsWith('http://hl7.org/fhir/StructureDefinition/') &&
    !url.includes('/us/') &&
    !url.includes('/uv/') &&
    !url.includes('/extensions/');
}

function fhirVersionFamily(sd: StructureDefinition): 'R4' | 'R5' | 'R6' | null {
  const sdFhirVersion = (sd as { fhirVersion?: string }).fhirVersion;
  if (!sdFhirVersion) return null;
  if (sdFhirVersion.startsWith('4.')) return 'R4';
  if (sdFhirVersion.startsWith('5.')) return 'R5';
  if (sdFhirVersion.startsWith('6.')) return 'R6';
  return null;
}

function matchesRequestedFhirVersion(sd: StructureDefinition, requested: 'R4' | 'R5' | 'R6'): boolean {
  const family = fhirVersionFamily(sd);
  return !family || family === requested;
}

function urlFhirVersionFamily(url: string): 'R4' | 'R5' | 'R6' | null {
  const match = url.match(/\/fhir\/([456])\.0(?:\.\d+)?\/StructureDefinition\//);
  if (!match) return null;
  if (match[1] === '4') return 'R4';
  if (match[1] === '5') return 'R5';
  if (match[1] === '6') return 'R6';
  return null;
}

function urlMatchesRequestedFhirVersion(url: string, requested: 'R4' | 'R5' | 'R6'): boolean {
  const family = urlFhirVersionFamily(url);
  return !family || family === requested;
}

function cacheDownloadedProfile(url: string, sd: StructureDefinition, context: AutoDownloadContext): void {
  const requested = context.fhirVersion || 'R4';
  const family = fhirVersionFamily(sd) ?? requested;
  context.cache.set(`${url}:${family}`, sd);
  context.availableProfiles.add(url);
}

// ============================================================================
// Request Deduplication and Negative Caching
// ============================================================================

/** In-flight requests to prevent duplicate parallel fetches */
const pendingRequests = new Map<string, Promise<StructureDefinition | null>>();

/** Negative cache for profiles that weren't found (TTL: 30 minutes - long enough for batch validation runs) */
const NOT_FOUND_CACHE_TTL_MS = 30 * 60 * 1000;
const notFoundCache = new Map<string, number>(); // url -> timestamp

/**
 * Clear negative cache for a specific URL (for testing or manual refresh)
 */
export function clearNotFoundCacheEntry(url: string): void {
  notFoundCache.delete(url);
}

/**
 * Clear all caches (for testing)
 */
export function clearAllCaches(): void {
  pendingRequests.clear();
  notFoundCache.clear();
}

/**
 * Attempt to auto-download a package for a profile URL
 * Implements request deduplication and negative caching to improve performance
 */
export async function attemptAutoDownload(
  url: string,
  context: AutoDownloadContext
): Promise<StructureDefinition | null> {
  // 1. Check negative cache first - skip profiles we already know don't exist
  const notFoundTimestamp = notFoundCache.get(url);
  if (notFoundTimestamp && Date.now() - notFoundTimestamp < NOT_FOUND_CACHE_TTL_MS) {
    logger.debug(`[SDLoader] Skipping ${url} - cached as not-found`);
    return null;
  }

  // 2. Deduplicate in-flight requests - wait for existing request instead of duplicating
  const pending = pendingRequests.get(url);
  if (pending) {
    logger.debug(`[SDLoader] Waiting for pending request: ${url}`);
    return pending;
  }

  // 3. Execute actual download
  const promise = executeAutoDownload(url, context);
  pendingRequests.set(url, promise);

  try {
    const result = await promise;

    // 4. Cache negative result to avoid repeated lookups
    if (result === null) {
      notFoundCache.set(url, Date.now());
    }

    return result;
  } finally {
    pendingRequests.delete(url);
  }
}

/**
 * Internal implementation of auto-download logic
 * Tries sources based on profileSourcesConfig settings
 */
async function executeAutoDownload(
  url: string,
  context: AutoDownloadContext
): Promise<StructureDefinition | null> {
  const requestedFhirVersion = context.fhirVersion || 'R4';
  if (!urlMatchesRequestedFhirVersion(url, requestedFhirVersion)) {
    logger.info(`[SDLoader] Skipping auto-download for FHIR-version-incompatible profile URL: ${url} (${requestedFhirVersion})`);
    return null;
  }

  const config = context.profileSourcesConfig || DEFAULT_PROFILE_SOURCES;
  logger.info(`[SDLoader] Profile not found locally, trying remote sources for: ${url}`);
  logger.debug(`[SDLoader] Enabled sources: Simplifier=${config.simplifier}, Registry=${config.packageRegistry}`);

  try {
    // Wrap auto-download in a timeout to prevent indefinite hangs
    const result = await Promise.race([
      (async () => {
        // Step 1: Try the embedder's external-fetch fallback (server
        // wires Simplifier.net here; standalone callers skip).
        if (config.simplifier) {
          try {
            const { getProfileSource } = await import('../persistence');
            const fetchExternal = getProfileSource().fetchExternalProfile;
            if (fetchExternal) {
              logger.info(`[SDLoader] Trying external-fetch fallback for: ${url}`);
              const sd = await fetchExternal(url);
              if (sd) {
                if (!matchesRequestedFhirVersion(sd, requestedFhirVersion)) {
                  logger.warn(`[SDLoader] Ignoring external profile with mismatched fhirVersion: ${url}`);
                } else {
                  cacheDownloadedProfile(url, sd as StructureDefinition, context);
                  logger.info(`[SDLoader] ✅ Profile fetched via external fallback: ${url}`);
                  return sd as StructureDefinition;
                }
              }
              logger.debug(`[SDLoader] Profile not found via external fallback`);
            }
          } catch (simplifierError: any) {
            logger.debug(`[SDLoader] External-fetch fallback failed:`, simplifierError.message);
          }
        }

        // Step 2: Try package registry if enabled
        if (config.packageRegistry) {
          const packageId = await context.registryClient.detectPackageForProfile(url);
          if (packageId && isPackageAllowed(packageId, context.allowedPackages)) {
            const pinnedVersion = context.packageVersionPins?.[packageId];
            logger.info(`[SDLoader] Detected package: ${packageId}${pinnedVersion ? `#${pinnedVersion}` : ''}`);

            const downloadResult = await context.packageDownloader.downloadAndInstall(packageId, pinnedVersion);

            if (downloadResult.success) {
              logger.info(`[SDLoader] ✅ Package downloaded: ${packageId}#${downloadResult.version}`);

              const sd = await loadFromLocalCache(url, context.packageSources, context.fhirVersion || 'R4');

              if (sd) {
                cacheDownloadedProfile(url, sd, context);
                logger.info(`[SDLoader] ✅ Profile loaded from package: ${url}`);
                return sd;
              }
              logger.warn(`[SDLoader] Profile still not found after downloading package: ${url}`);
            } else {
              logger.warn(`[SDLoader] Failed to download package ${packageId}: ${downloadResult.error}`);
            }
          } else if (!packageId) {
            logger.debug(`[SDLoader] Package not found in registry for: ${url}`);
          } else {
            logger.warn(`[SDLoader] Package ${packageId} is not in allowed list`);
          }
        }

        return null;
      })(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Auto-download timeout after 20s')), 20000)
      )
    ]);

    return result;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(`[SDLoader] Auto-download failed or timed out for ${url}:`, err.message);
    return null;
  }
}

/**
 * Check if a profile URL is public (eligible for auto-download)
 * 
 * Returns true for any https:// URL - these can be fetched via Simplifier or direct HTTP.
 * Returns false for internal/urn:uuid: style URLs.
 */
export function isPublicProfile(url: string): boolean {
  // Any HTTP/HTTPS URL is considered public and can be fetched
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return true;
  }

  // Local/internal URLs are not public
  return false;
}
