import { logger } from '../logger.js';
import { getProfileSource } from '../persistence/index.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import { cacheKeyForProfile, fhirVersionFamily } from './sd-loader-version-utils.js';
import type { StructureDefinition } from './structure-definition-types.js';

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
      const requestedCanonical = result.version
        ? `${result.canonicalUrl}|${result.version}`
        : result.canonicalUrl;
      if (!profileMatchesCanonical(result.profile, requestedCanonical)) continue;

      const sanitized = sanitizeProfile(result.profile);
      const family = fhirVersionFamily(sanitized);
      if (family) {
        cache.set(cacheKeyForProfile(result.canonicalUrl, family), sanitized);
        if (result.version && result.version !== 'unknown') {
          const versionedCanonical = `${result.canonicalUrl}|${result.version}`;
          cache.set(cacheKeyForProfile(versionedCanonical, family), sanitized);
          availableProfiles.add(versionedCanonical);
        }
      }
      availableProfiles.add(result.canonicalUrl);
    }

    const warmupTime = Date.now() - warmupStart;
    logger.info(`[SDLoader] 🔥 Warm-up complete: ${loadedProfiles.size} profiles loaded in ${warmupTime}ms`);
  } catch (error: unknown) {
    logger.warn(
      '[SDLoader] ProfileSource warm-up failed',
      validationFailureMetadata(error),
    );
  }
}
