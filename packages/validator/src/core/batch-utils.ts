/**
 * Records Validator - Batch Utilities
 *
 * Helper functions for batch validation:
 * - Resource deduplication
 * - Grouping by profile
 * - Chunking for parallel processing
 */

import { createHash } from 'crypto';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { ProfileCache } from '../cache/profile-cache';
import type { StructureDefinition } from './structure-definition-types';
import type { SnapshotGenerator } from './snapshot-generator';
import { logger } from '../logger';
import { getProfileSource } from '../persistence';

// Module-level flag to prevent redundant warmups within a validation session
let warmupCompleted = false;

/** Reset warmup flag for new validation sessions */
export function resetWarmupState(): void {
  warmupCompleted = false;
}

export interface DeduplicationResult<T> {
  unique: T[];
  duplicateMap: Map<string, T[]>;
}

export function deduplicateResources<T extends object>(resources: T[]): DeduplicationResult<T> {
  const hashMap = new Map<string, T[]>();

  for (const resource of resources) {
    const content = JSON.stringify(resource);
    const hash = createHash('sha256').update(content).digest('hex');

    if (!hashMap.has(hash)) {
      hashMap.set(hash, []);
    }
    hashMap.get(hash)!.push(resource);
  }

  const unique = Array.from(hashMap.values()).map(group => group[0]);

  return { unique, duplicateMap: hashMap };
}

export function groupResourcesByProfile(
  resources: any[],
  explicitProfileUrl?: string
): Map<string, any[]> {
  const groups = new Map<string, any[]>();

  for (const resource of resources) {
    let profileUrl: string;

    if (explicitProfileUrl) {
      profileUrl = explicitProfileUrl;
    } else {
      const declaredProfiles = resource.meta?.profile || [];
      profileUrl = declaredProfiles.length > 0
        ? declaredProfiles[0]
        : `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    }

    if (!groups.has(profileUrl)) {
      groups.set(profileUrl, []);
    }
    groups.get(profileUrl)!.push(resource);
  }

  return groups;
}

// eslint-disable-next-line max-lines-per-function
export async function preloadProfiles(
  sdLoader: StructureDefinitionLoader,
  profileCache: ProfileCache,
  snapshotGenerator: SnapshotGenerator,
  profileUrls: string[],
  fhirVersion: 'R4' | 'R5' | 'R6',
  fhirClient?: any,
  settings?: any
): Promise<void> {
  const startTime = Date.now();

  const profilesMap = new Map<string, StructureDefinition>();

  // Phase 2 Optimization: Aggressive Warmup (runs only ONCE per session)
  // Pre-load frequently used profiles from DB into memory cache FIRST
  if (!warmupCompleted) {
    const warmupResult = await warmupProfileCacheFromDatabase(profileCache);
    warmupCompleted = true; // Mark as done for this session
    if (warmupResult.warmedUp > 0) {
      logger.info(`[RecordsValidator] 🔥 Warmup: ${warmupResult.warmedUp} profiles pre-loaded in ${warmupResult.timeMs}ms`);
    }
  }

  // 1. First: Try loading from SDLoader (Memory Cache → DB Cache → Bundled)
  // This is the fastest path since Phase 1 warm-up pre-populates the cache
  logger.info(`[RecordsValidator] ⚡ Loading ${profileUrls.length} profiles (DB/Cache priority)...`);

  const sdLoaderResults = await sdLoader.loadProfilesBatch(profileUrls, fhirVersion);

  for (const [url, sd] of sdLoaderResults.entries()) {
    profilesMap.set(url, sd);
  }

  // Identify profiles not found in SDLoader
  const urlsToResolve: string[] = [];
  for (const url of profileUrls) {
    if (!sdLoaderResults.has(url) && !profilesMap.has(url)) {
      urlsToResolve.push(url);
    }
  }

  logger.info(`[RecordsValidator] ✓ Loaded ${profilesMap.size}/${profileUrls.length} from cache. Need to resolve ${urlsToResolve.length} via ProfileResolver.`);

  // 2. Use the embedder's ProfileSource for missing profiles (unified
  //    multi-source resolution backed by whatever the host wired up —
  //    e.g. the server's ProfileResolver). Standalone callers without a
  //    `resolveProfile` implementation skip this step silently.
  const source = getProfileSource();
  if (urlsToResolve.length > 0 && source.resolveProfile) {
    const resolveProfile = source.resolveProfile.bind(source);
    try {
      logger.info(`[RecordsValidator] 🔄 Resolving ${urlsToResolve.length} profiles via ProfileSource...`);

      // Process in chunks to avoid overwhelming the resolver
      // (15 picked empirically for parallelism vs back-pressure tradeoff)
      const chunks = chunkArray(urlsToResolve, 15);
      let resolvedCount = 0;

      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (url) => {
          try {
            const profile = await resolveProfile(url, undefined, settings);
            if (profile) {
              profilesMap.set(url, profile);
              // Cache in sdLoader for future runs
              sdLoader.cacheProfile(url, profile, fhirVersion);
              resolvedCount++;
            }
          } catch {
            // Ignore individual resolution failures
            logger.debug(`[RecordsValidator] Failed to resolve: ${url}`);
          }
        }));
      }

      logger.info(`[RecordsValidator] ✓ ProfileSource resolved ${resolvedCount} additional profiles.`);
    } catch {
      logger.warn(`[RecordsValidator] ProfileSource resolveProfile threw, skipping advanced resolution.`);
    }
  }

  logger.info(`[RecordsValidator] Loaded ${profilesMap.size}/${profileUrls.length} profiles in batch`);

  const snapshotPromises: Promise<void>[] = [];

  for (const [profileUrl, structureDef] of profilesMap.entries()) {
    if (!structureDef.snapshot && structureDef.differential && structureDef.baseDefinition) {
      const snapshotCacheKey = `${profileUrl}:${fhirVersion}:snapshot`;
      const cachedSnapshot = profileCache.get(snapshotCacheKey) as StructureDefinition | undefined;

      if (cachedSnapshot && cachedSnapshot.snapshot) {
        logger.debug(`[RecordsValidator] Using cached snapshot for ${profileUrl}`);
        structureDef.snapshot = cachedSnapshot.snapshot;
      } else {
        const snapshotPromise = (async () => {
          try {
            const elements = await snapshotGenerator.generateSnapshot(structureDef);
            if (elements && elements.length > 0) {
              const withSnapshot: StructureDefinition = {
                ...structureDef,
                snapshot: { element: elements }
              };
              profileCache.set(snapshotCacheKey, withSnapshot);
              logger.debug(`[RecordsValidator] Cached generated snapshot for ${profileUrl}`);
            }
          } catch (error) {
            logger.warn(`[RecordsValidator] Failed to generate snapshot for ${profileUrl}:`, error);
          }
        })();

        snapshotPromises.push(snapshotPromise);
      }
    } else if (structureDef) {
      // Even if it has a snapshot, ensure it's in the ProfileCache for subsequent fast lookups
      // (especially if it came from FhirClient or SDLoader which might not share cache)
      const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`; // Use consistent key
      if (!profileCache.get(cacheKey)) {
        profileCache.set(cacheKey, structureDef);
      }
    }
  }

  if (snapshotPromises.length > 0) {
    logger.info(`[RecordsValidator] Generating ${snapshotPromises.length} snapshot(s) in parallel...`);
    await Promise.all(snapshotPromises);
  }

  const totalTime = Date.now() - startTime;
  logger.info(`[RecordsValidator] Profile preloading complete in ${totalTime}ms`);
}

export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Phase 2 Optimization: Aggressive Warmup
 * 
 * Pre-loads frequently used profiles from the database into the memory cache.
 * This eliminates external API calls for profiles that were previously resolved.
 * 
 * Expected improvement: ~90% reduction in profile loading time
 */
export async function warmupProfileCacheFromDatabase(
  profileCache: ProfileCache,
  limit: number = 300
): Promise<{ warmedUp: number; timeMs: number }> {
  const startTime = Date.now();
  const source = getProfileSource();
  if (!source.warmupRecent) {
    // Standalone (CLI / npm-package) callers don't have a backing
    // database, so this is a noop. The bundled-profile cache is already
    // loaded by the SDLoader at boot.
    return { warmedUp: 0, timeMs: Date.now() - startTime };
  }

  try {
    const result = await source.warmupRecent(
      (cacheKey, sd) => profileCache.set(cacheKey, sd),
      (cacheKey) => profileCache.get(cacheKey),
      limit,
    );
    logger.info(`[Warmup] ✅ Pre-loaded ${result.warmedUp} profiles into memory cache in ${result.timeMs}ms`);
    return result;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(`[Warmup] Failed to warm up profile cache: ${err.message}`);
    return { warmedUp: 0, timeMs: Date.now() - startTime };
  }
}
