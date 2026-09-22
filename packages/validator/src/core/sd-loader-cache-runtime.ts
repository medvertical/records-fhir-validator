import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { scanProfileSources } from './sd-loader-package-source-scanning.js';
import { warmUpProfilesFromDatabase } from './sd-loader-profile-source-warmup.js';
import type { StructureDefinition } from './structure-definition-types.js';

interface StructureDefinitionCacheInitialization {
  packageSources: string[];
  availableProfiles: Set<string>;
  packageVersionPins: Record<string, string>;
  prewarmProfileSource: boolean;
  cache: Map<string, StructureDefinition>;
  maxCacheEntries: number;
  externalProfileCacheKeys: Set<string>;
}

export async function initializeStructureDefinitionCache(
  input: StructureDefinitionCacheInitialization,
): Promise<void> {
  const startTime = Date.now();
  try {
    await scanProfileSources({
      packageSources: input.packageSources,
      availableProfiles: input.availableProfiles,
      packageVersionPins: input.packageVersionPins,
    });
    if (input.prewarmProfileSource) {
      await warmUpProfilesFromDatabase({
        cache: input.cache,
        availableProfiles: input.availableProfiles,
      });
    }
    pruneReloadableProfileCache(
      input.cache,
      input.maxCacheEntries,
      input.externalProfileCacheKeys,
    );
    const elapsed = Date.now() - startTime;
    logger.info(`[SDLoader] ✅ Initialization complete in ${elapsed}ms (bundled: ${input.availableProfiles.size}, cached: ${input.cache.size})`);
  } catch (error) {
    logger.warn('[SDLoader] Cache initialization failed', validationFailureMetadata(error));
  }
}

export function pruneReloadableProfileCache(
  cache: Map<string, StructureDefinition>,
  maxCacheEntries: number,
  externalProfileCacheKeys: Set<string>,
): void {
  while (cache.size > maxCacheEntries) {
    const oldestEvictableKey = [...cache.keys()]
      .find(cacheKey => !externalProfileCacheKeys.has(cacheKey));
    if (oldestEvictableKey === undefined) break;
    cache.delete(oldestEvictableKey);
  }
}

export function hasRequiredBaseProfiles(availableProfiles: Set<string>): boolean {
  return [
    'http://hl7.org/fhir/StructureDefinition/Patient',
    'http://hl7.org/fhir/StructureDefinition/Observation',
  ].some(profileUrl => availableProfiles.has(profileUrl));
}
