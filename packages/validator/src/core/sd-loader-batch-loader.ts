import { logger } from '../logger.js';
import type { StructureDefinition } from './structure-definition-types.js';
import {
  cacheKeyForProfile,
  normalizeVersionedCoreStructureDefinitionUrl,
  urlMatchesRequestedFhirVersion,
} from './sd-loader-version-utils.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

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
        const resolvedUrl = resolvePinnedCanonical(normalizeVersionedCoreStructureDefinitionUrl(url, fhirVersion));
        if (sd && profileMatchesCanonical(sd, url, fhirVersion) && profileMatchesCanonical(sd, resolvedUrl, fhirVersion)) {
          results.set(url, sd);
        }
      } catch (error: unknown) {
        logger.warn(
          '[SDLoader] Batch profile load failed',
          validationFailureMetadata(error),
        );
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
    logger.error('[SDLoader] Batch load failed', validationFailureMetadata(error));
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
    if (!urlMatchesRequestedFhirVersion(url, fhirVersion)) {
      uncachedUrls.push(url);
      continue;
    }

    const lookupUrl = normalizeVersionedCoreStructureDefinitionUrl(url, fhirVersion);
    const resolvedUrl = resolvePinnedCanonical(lookupUrl);
    const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);
    const cached = cache.get(cacheKey);
    if (cached && profileMatchesCanonical(cached, url, fhirVersion) && profileMatchesCanonical(cached, resolvedUrl, fhirVersion)) {
      results.set(url, cached);
    } else {
      if (cached) cache.delete(cacheKey);
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
