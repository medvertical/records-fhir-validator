import { logger } from '../logger';
import type { StructureDefinition } from './structure-definition-types';
import {
  cacheKeyForProfile,
  matchesRequestedFhirVersion,
} from './sd-loader-version-utils';

interface LoadProfilesBatchArgs {
  urls: string[];
  fhirVersion: 'R4' | 'R5' | 'R6';
  cache: Map<string, StructureDefinition>;
  resolvePinnedCanonical: (url: string) => string;
  loadProfile: (url: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<StructureDefinition | null>;
}

export async function loadProfilesBatchWithCache({
  urls,
  fhirVersion,
  cache,
  resolvePinnedCanonical,
  loadProfile,
}: LoadProfilesBatchArgs): Promise<Map<string, StructureDefinition>> {
  const startTime = Date.now();
  const results = new Map<string, StructureDefinition>();

  logger.info(`[SDLoader] Batch loading ${urls.length} profile(s)`);

  try {
    const uniqueUrls = Array.from(new Set(urls));
    logger.debug(`[SDLoader] Deduplicated: ${urls.length} → ${uniqueUrls.length} unique URLs`);

    const uncachedUrls = collectUncachedUrls(uniqueUrls, fhirVersion, cache, resolvePinnedCanonical, results);
    logger.info(`[SDLoader] Cache hits: ${results.size}/${uniqueUrls.length}, need to load: ${uncachedUrls.length}`);

    await Promise.all(uncachedUrls.map(async url => {
      try {
        const sd = await loadProfileWithTimeout(url, fhirVersion, loadProfile);
        if (sd) {
          results.set(url, sd);
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`[SDLoader] Failed to load profile ${url}:`, err.message || error);
      }
    }));

    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / urls.length;
    logger.info(
      `[SDLoader] Batch load complete in ${totalTime}ms ` +
      `(avg ${avgTime.toFixed(2)}ms/profile, ${results.size}/${uniqueUrls.length} loaded)`
    );

    return results;
  } catch (error) {
    logger.error('[SDLoader] Batch load error:', error);
    return results;
  }
}

function collectUncachedUrls(
  uniqueUrls: string[],
  fhirVersion: 'R4' | 'R5' | 'R6',
  cache: Map<string, StructureDefinition>,
  resolvePinnedCanonical: (url: string) => string,
  results: Map<string, StructureDefinition>
): string[] {
  const uncachedUrls: string[] = [];

  for (const url of uniqueUrls) {
    const resolvedUrl = resolvePinnedCanonical(url);
    const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);
    const cached = cache.get(cacheKey);
    if (cached && matchesRequestedFhirVersion(cached, fhirVersion)) {
      results.set(url, cached);
    } else {
      uncachedUrls.push(url);
    }
  }

  return uncachedUrls;
}

function loadProfileWithTimeout(
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  loadProfile: (url: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<StructureDefinition | null>
): Promise<StructureDefinition | null> {
  return Promise.race([
    loadProfile(url, fhirVersion),
    new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error(`Profile load timeout after 30s: ${url}`)), 30000)
    )
  ]);
}
