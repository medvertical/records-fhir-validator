import type { StructureDefinition } from './structure-definition-types.js';
import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { getProfileSourceRevision } from '../persistence/index.js';
import { isPublicProfileUrl } from './remote-profile-url-policy.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import {
  executeAutoDownload,
  type AutoDownloadAttemptResult,
  type AutoDownloadSourceContext,
} from './sd-loader-auto-download-sources.js';

export type { AutoDownloadAttemptResult } from './sd-loader-auto-download-sources.js';

export interface AutoDownloadContext extends AutoDownloadSourceContext {
  /** Mutable deduplication/miss state owned by one StructureDefinitionLoader. */
  autoDownloadState?: AutoDownloadState;
}

// ============================================================================
// Request Deduplication and Negative Caching
// ============================================================================

/** Short per-resolution-policy miss cache; request batches still avoid repeated remote calls. */
const NOT_FOUND_CACHE_TTL_MS = 30 * 1000;

export class AutoDownloadState {
  private readonly pendingRequests = new Map<string, Promise<AutoDownloadAttemptResult>>();
  private readonly notFoundCache = new BoundedLruCache<string, number>(2_000);
  private cacheRevision = 0;

  get revision(): number {
    return this.cacheRevision;
  }

  getPending(key: string): Promise<AutoDownloadAttemptResult> | undefined {
    return this.pendingRequests.get(key);
  }

  setPending(key: string, request: Promise<AutoDownloadAttemptResult>): void {
    this.pendingRequests.set(key, request);
  }

  deletePending(key: string, request: Promise<AutoDownloadAttemptResult>): void {
    if (this.pendingRequests.get(key) === request) this.pendingRequests.delete(key);
  }

  getMiss(key: string): number | undefined {
    return this.notFoundCache.get(key);
  }

  setMiss(key: string, timestamp: number): void {
    this.notFoundCache.set(key, timestamp);
  }

  deleteMiss(key: string): void {
    this.notFoundCache.delete(key);
  }

  clearEntry(url: string): void {
    this.cacheRevision += 1;
    for (const key of this.notFoundCache.keys()) {
      if (key.startsWith(`${url}\n`)) this.notFoundCache.delete(key);
    }
    for (const key of this.pendingRequests.keys()) {
      if (key.startsWith(`${url}\n`)) this.pendingRequests.delete(key);
    }
  }

  clear(): void {
    this.cacheRevision += 1;
    this.pendingRequests.clear();
    this.notFoundCache.clear();
  }
}

/**
 * Clear negative cache for a specific URL (for testing or manual refresh)
 */
export function clearNotFoundCacheEntry(url: string, state?: AutoDownloadState): void {
  state?.clearEntry(url);
}

/**
 * Clear all caches (for testing)
 */
export function clearAllCaches(state?: AutoDownloadState): void {
  state?.clear();
}

/**
 * Attempt to auto-download a package for a profile URL
 * Implements request deduplication and negative caching to improve performance
 */
export async function attemptAutoDownload(
  url: string,
  context: AutoDownloadContext
): Promise<StructureDefinition | null> {
  const state = context.autoDownloadState ??= new AutoDownloadState();
  const requestKey = autoDownloadRequestKey(url, context);
  const requestRevision = state.revision;

  // 1. Check negative cache first - skip profiles we already know don't exist
  const notFoundTimestamp = state.getMiss(requestKey);
  if (notFoundTimestamp && Date.now() - notFoundTimestamp < NOT_FOUND_CACHE_TTL_MS) {
    logger.debug('[SDLoader] Skipping cached not-found profile', profileCanonicalMetadata(url));
    return null;
  }

  // 2. Deduplicate in-flight requests - wait for existing request instead of duplicating
  const pending = state.getPending(requestKey);
  if (pending) {
    logger.debug('[SDLoader] Waiting for pending profile request', profileCanonicalMetadata(url));
    return (await pending).profile;
  }

  // 3. Execute actual download
  const promise = executeAutoDownload(url, context);
  state.setPending(requestKey, promise);

  try {
    const result = await promise;

    // 4. Cache negative result to avoid repeated lookups
    if (state.revision === requestRevision) {
      if (result.profile === null && result.cacheableMiss) {
        state.setMiss(requestKey, Date.now());
      } else {
        state.deleteMiss(requestKey);
      }
    }

    return result.profile;
  } finally {
    state.deletePending(requestKey, promise);
  }
}

function autoDownloadRequestKey(
  url: string,
  context: AutoDownloadContext,
): string {
  const config = normalizeProfileSourcesConfig(context.profileSourcesConfig);
  const policy = {
    fhirVersion: context.fhirVersion ?? 'R4',
    simplifier: config.simplifier,
    packageRegistry: config.packageRegistry,
    profileSourceRevision: getProfileSourceRevision(),
    allowedPackages: [...context.allowedPackages].sort(),
    packageSources: [...context.packageSources].sort(),
    packageVersionPins: Object.entries(context.packageVersionPins ?? {})
      .sort(([left], [right]) => left.localeCompare(right)),
    selectedCorePackageId: context.selectedCorePackageId,
  };
  return `${url}\n${JSON.stringify(policy)}`;
}

/**
 * Check if a profile URL is public (eligible for auto-download)
 * 
 * Returns true for any https:// URL - these can be fetched via Simplifier or direct HTTP.
 * Returns false for internal/urn:uuid: style URLs.
 */
export function isPublicProfile(url: string): boolean {
  return isPublicProfileUrl(url);
}
