import { extensionDefinitionCacheKey, loadExtensionProfile, rethrowUnavailableProfile } from './extension-profile-cache.js';
import { SnapshotGenerator } from '../core/snapshot-generator.js';
import { copyProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { logger } from '../logger.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type {
  ProfileReferenceSource,
  StructureDefinitionLoader,
} from '../core/structure-definition-loader.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { extractSubExtensionDefinitions } from './extension-definition-extractor.js';
import type { ExtensionProfileCache } from './extension-profile-cache.js';
import type { ExtensionDefinition } from './extension-types.js';

/**
 * Load and cache the nested definitions owned by one extension profile;
 * undefined when the profile itself cannot be loaded.
 */
export async function getSubExtensionDefinitions(
  parentProfileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  sdLoader: StructureDefinitionLoader,
  cache: ExtensionProfileCache<Map<string, ExtensionDefinition>>,
  referencingProfile?: ProfileReferenceSource,
): Promise<Map<string, ExtensionDefinition> | undefined> {
  let parentSD: StructureDefinition | null = null;
  try {
    parentSD = await loadExtensionProfile(sdLoader, parentProfileUrl, referencingProfile, fhirVersion);
  } catch (error: unknown) {
    rethrowUnavailableProfile(error);
    logger.warn('[ExtensionValidator] Failed to load parent extension profile', {
      ...profileCanonicalMetadata(parentProfileUrl),
      ...validationFailureMetadata(error),
    });
  }

  if (!parentSD) return undefined;
  const cacheKey = extensionDefinitionCacheKey(parentSD, fhirVersion);
  const suppliedSnapshot = Boolean(parentSD.snapshot?.element?.length);
  const cached = suppliedSnapshot ? cache.get(cacheKey) : undefined;
  if (cached) return cached;
  if (!suppliedSnapshot && parentSD.differential?.element?.length) {
    const element = await new SnapshotGenerator(sdLoader).generateSnapshot(parentSD, { fhirVersion, cacheResults: false });
    const materialized = { ...parentSD, snapshot: { element } };
    copyProfilePackageProvenance(parentSD, materialized);
    parentSD = materialized;
  }
  const result = new Map<string, ExtensionDefinition>();

  for (const [url, definition] of extractSubExtensionDefinitions(parentSD)) {
    result.set(url, definition);
  }

  if (suppliedSnapshot) cache.set(cacheKey, result);
  logger.debug('[ExtensionValidator] Extracted sub-extension definitions', {
    ...profileCanonicalMetadata(parentProfileUrl),
    definitionCount: result.size,
  });
  return result;
}
