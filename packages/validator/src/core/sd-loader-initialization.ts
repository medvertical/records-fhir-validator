import { promises as fs } from 'fs';
import { logger } from '../logger';
import { getProfileSource } from '../persistence';
import type { StructureDefinition } from './structure-definition-types';
import { scanCacheDirectory } from './sd-loader-package-scanner';
import { cacheKeyForProfile, fhirVersionFamily } from './sd-loader-version-utils';
import { sanitizeProfile } from './sd-loader-profile-sanitizer';

export async function scanProfileSources(params: {
  packageSources: string[];
  availableProfiles: Set<string>;
  packageVersionPins: Record<string, string>;
}): Promise<number> {
  const { packageSources, availableProfiles, packageVersionPins } = params;
  let sourcesFound = 0;

  for (const source of packageSources) {
    try {
      await fs.access(source);
      logger.info(`[SDLoader] Scanning package source: ${source}`);
      await scanCacheDirectory(source, availableProfiles, { packageVersionPins });
      sourcesFound++;
    } catch {
      logger.debug(`[SDLoader] Package source not found: ${source}`);
    }
  }

  if (sourcesFound === 0) {
    logger.warn('[SDLoader] No package sources found! Validator will have limited functionality.');
  }

  return sourcesFound;
}

export async function warmUpProfilesFromDatabase(params: {
  cache: Map<string, StructureDefinition>;
  availableProfiles: Set<string>;
}): Promise<void> {
  const { cache, availableProfiles } = params;
  const source = getProfileSource();

  if (!source.loadAllForWarmup) {
    return;
  }

  try {
    logger.info('[SDLoader] 🔥 Starting ProfileSource warm-up...');
    const warmupStart = Date.now();

    const loadedProfiles = await source.loadAllForWarmup();

    for (const [, result] of loadedProfiles.entries()) {
      if (!result.profile) continue;

      const sanitized = sanitizeProfile(result.profile);
      const family = fhirVersionFamily(sanitized);
      if (family) {
        cache.set(cacheKeyForProfile(result.canonicalUrl, family), sanitized);
      }
      availableProfiles.add(result.canonicalUrl);
    }

    const warmupTime = Date.now() - warmupStart;
    logger.info(`[SDLoader] 🔥 Warm-up complete: ${loadedProfiles.size} profiles loaded in ${warmupTime}ms`);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(`[SDLoader] ProfileSource warm-up failed (non-critical): ${err.message}`);
  }
}
