/**
 * Profile-load pipeline for StructureDefinitionLoader.
 *
 * The full loadProfile() flow — pinned-canonical resolution, negative caches,
 * in-memory + DB cache checks, and the known-source fallback (local package
 * filesystem then auto-download). Extracted from structure-definition-loader.ts;
 * the loader passes its mutable caches/maps by reference so updates propagate
 * back, plus a resolvePinnedCanonical callback for its private pin map.
 */

import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger.js';
import type { StructureDefinition } from './structure-definition-types.js';
import type { ProfileSourcesConfig, ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { loadFromLocalCache } from './sd-loader-filesystem.js';
import { checkDatabaseCache } from './sd-loader-db-cache.js';
import { attemptAutoDownload, isPublicProfile, type AutoDownloadState } from './sd-loader-auto-download.js';
import {
  cacheKeyForProfile,
  normalizeVersionedCoreStructureDefinitionUrl,
  urlMatchesRequestedFhirVersion,
} from './sd-loader-version-utils.js';
import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import type { PackageProfileIndexCache } from './sd-loader-package-profile-index.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import {
  isTenantScopedProfileRequest,
  resolveTenantProfileFromSource,
} from './tenant-profile-source-resolution.js';

export interface LoadProfileContext {
  availableProfiles: Set<string>;
  packageSources: string[];
  cache: Map<string, StructureDefinition>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
  autoDownload: boolean;
  registryClient: PackageRegistryClient;
  packageDownloader: PackageDownloader;
  allowedPackages: string[];
  packageVersionPins: Record<string, string>;
  selectedCorePackageId?: string;
  profileSourcesConfig: ProfileSourcesConfig;
  profileSourceContext?: ProfileSourceContext;
  profileResolutionSettings?: ValidationSettings;
  resolvePinnedCanonical(url: string): string;
  canCache?(): boolean;
  autoDownloadState: AutoDownloadState;
  packageProfileIndexCache?: PackageProfileIndexCache;
}

/**
 * Load a StructureDefinition by URL.
 */
export async function loadProfile(
  ctx: LoadProfileContext,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): Promise<StructureDefinition | null> {
  try {
    // OPTIMIZATION: Skip filesystem scanning entirely - rely on DB cache + auto-download
    // Filesystem scans are extremely slow (30s for 36 packages with 1000+ profiles)
    // DB cache is fast (2ms) and auto-download handles missing profiles (20s timeout)
    // Canonical pinning: if the URL is unversioned and we have a pinned
    // resolution, redirect to the versioned form. This makes runtime
    // resolution deterministic regardless of which packages are loaded.
    if (!urlMatchesRequestedFhirVersion(url, fhirVersion)) {
      logger.debug('[SDLoader] Skipping FHIR-version-incompatible profile', {
        ...profileCanonicalMetadata(url),
        fhirVersion,
      });
      return null;
    }

    const lookupUrl = normalizeVersionedCoreStructureDefinitionUrl(url, fhirVersion);
    const resolvedUrl = ctx.resolvePinnedCanonical(lookupUrl);

    // Use version-specific cache key to avoid R4/R5 confusion
    const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);

    // For a tenant-scoped validation, non-core profiles must be resolved by
    // the embedder before any shared memory/DB/filesystem cache is consulted.
    // A null result intentionally stops here: globally installed but inactive
    // packages are not valid inputs for this organization.
    const scopedProfile = await resolveScopedProfile(
      ctx,
      resolvedUrl,
      fhirVersion,
    );
    if (scopedProfile !== undefined) {
      if (!scopedProfile) return null;
      const sanitized = sanitizeProfile(scopedProfile);
      if (policyAllowsCaching(ctx)) {
        ctx.cache.set(cacheKey, sanitized);
        ctx.availableProfiles.add(resolvedUrl);
      }
      return sanitized;
    }

    // Check in-memory cache first (version-specific)
    if (ctx.cache.has(cacheKey)) {
      logger.debug('[SDLoader] Loading profile from in-memory cache', profileCanonicalMetadata(resolvedUrl));
      return ctx.cache.get(cacheKey)!;
    }

    // Check database cache (from ProfileResolver downloads)
    const dbCachedProfile = await checkDatabaseCache(
      resolvedUrl,
      fhirVersion,
      ctx.profileSourceContext,
    );
    if (dbCachedProfile) {
      // Cache it in memory with version-specific key
      const sanitized = sanitizeProfile(dbCachedProfile);
      if (policyAllowsCaching(ctx)) {
        ctx.cache.set(cacheKey, sanitized);
        ctx.availableProfiles.add(resolvedUrl);
        if (lookupUrl !== resolvedUrl) ctx.availableProfiles.add(lookupUrl);
      }
      return sanitized;
    }

    // Skip scanning for private profiles UNLESS they're in availableProfiles
    const isInBundledProfiles = ctx.availableProfiles.has(url) ||
      ctx.availableProfiles.has(lookupUrl) ||
      ctx.availableProfiles.has(resolvedUrl);
    const publicProfile = isPublicProfile(lookupUrl);

    if (!publicProfile && !isInBundledProfiles) {
      logger.debug('[SDLoader] Skipping filesystem/auto-download for private profile', profileCanonicalMetadata(url));
      return null;
    }

    if (!publicProfile && isInBundledProfiles) {
      logger.debug('[SDLoader] Bundled profile will load from filesystem', profileCanonicalMetadata(url));
    }

    // OPTIMIZATION: Filesystem scanning disabled entirely
    // Filesystem scans are too slow (30s+ for 36 packages with 1000+ profiles)
    // DB cache (2ms) + auto-download (20s timeout) is much faster
    logger.debug('[SDLoader] Filesystem scan skipped by policy', profileCanonicalMetadata(url));

    const existingLoad = ctx.profileLoadPromises.get(cacheKey);
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = loadProfileFromKnownSources(ctx, url, lookupUrl, resolvedUrl, cacheKey, fhirVersion).finally(() => {
      if (ctx.profileLoadPromises.get(cacheKey) === loadPromise) {
        ctx.profileLoadPromises.delete(cacheKey);
      }
    });

    ctx.profileLoadPromises.set(cacheKey, loadPromise);
    return loadPromise;

  } catch (error: unknown) {
    logger.error(
      '[SDLoader] Profile load failed',
      validationFailureMetadata(error),
    );
    return null;
  }
}

/** undefined = normal unscoped pipeline; null = scoped lookup was authoritative but missed. */
async function resolveScopedProfile(
  ctx: LoadProfileContext,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null | undefined> {
  const context = ctx.profileSourceContext;
  if (!isTenantScopedProfileRequest(url, context)) {
    return undefined;
  }

  const profile = await resolveTenantProfileFromSource(
    url,
    fhirVersion,
    context,
    ctx.profileResolutionSettings,
  );
  if (!profile) return null;
  const profileFhirVersion = (profile as { fhirVersion?: string }).fhirVersion;
  if (!profileFhirVersion) return profile;
  const expectedPrefix = fhirVersion === 'R4' ? '4.' : fhirVersion === 'R5' ? '5.' : '6.';
  return profileFhirVersion.startsWith(expectedPrefix) ? profile : null;
}

function hasExplicitCanonicalVersion(url: string): boolean {
  const separatorIndex = url.indexOf('|');
  return separatorIndex > 0 && separatorIndex < url.length - 1;
}

async function loadProfileFromKnownSources(
  ctx: LoadProfileContext,
  url: string,
  lookupUrl: string,
  resolvedUrl: string,
  cacheKey: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null> {
  const shouldTryFilesystem =
    ctx.availableProfiles.has(url) ||
    ctx.availableProfiles.has(lookupUrl) ||
    ctx.availableProfiles.has(resolvedUrl) ||
    hasExplicitCanonicalVersion(resolvedUrl);

  if (shouldTryFilesystem) {
    logger.debug('[SDLoader] Loading profile from filesystem', profileCanonicalMetadata(url));
    const sd = await loadFromLocalCache(
      resolvedUrl,
      ctx.packageSources,
      fhirVersion,
      ctx.packageVersionPins,
      ctx.packageProfileIndexCache,
      ctx.selectedCorePackageId,
    );

    if (sd) {
      const sanitized = sanitizeProfile(sd);
      if (policyAllowsCaching(ctx)) ctx.cache.set(cacheKey, sanitized);
      return sanitized;
    }

    logger.warn('[SDLoader] Available profile failed to load', profileCanonicalMetadata(url));
    if (!ctx.autoDownload) {
      return null;
    }
  }

  if (ctx.autoDownload) {
    const downloadedProfile = await attemptAutoDownload(resolvedUrl, {
      registryClient: ctx.registryClient,
      packageDownloader: ctx.packageDownloader,
      allowedPackages: ctx.allowedPackages,
      packageVersionPins: ctx.packageVersionPins,
      selectedCorePackageId: ctx.selectedCorePackageId,
      packageSources: ctx.packageSources,
      cache: ctx.cache,
      availableProfiles: ctx.availableProfiles,
      profileSourcesConfig: ctx.profileSourcesConfig,
      fhirVersion,
      canCache: ctx.canCache,
      autoDownloadState: ctx.autoDownloadState,
      packageProfileIndexCache: ctx.packageProfileIndexCache,
    });

    if (downloadedProfile) {
      const sanitized = sanitizeProfile(downloadedProfile);
      if (policyAllowsCaching(ctx)) ctx.cache.set(cacheKey, sanitized);
      return sanitized;
    }

    logger.warn('[SDLoader] Profile not found', profileCanonicalMetadata(url));
    logger.debug('[SDLoader] Auto-download was enabled');
    return null;
  }

  logger.warn('[SDLoader] Profile not found', profileCanonicalMetadata(url));
  logger.debug('[SDLoader] Auto-download was disabled');
  return null;
}

function policyAllowsCaching(ctx: LoadProfileContext): boolean {
  return ctx.canCache?.() ?? true;
}
