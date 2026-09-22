import { logger } from '../logger.js';
import type { ProfileCache } from '../cache/profile-cache.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructuralExecutor } from './executors/index.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import type { FhirResource } from './fhir-resource.js';
import { loadProfileWithSnapshot } from './profile-loader-utils.js';
import {
  createProfileResourceTypeMismatchIssue,
  getIncompatibleProfileResourceType,
} from './profile-resource-type.js';
import { getValueAtPath } from './validation-utils.js';

export interface StructureProfileValidationDeps {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
}

export async function validateStructureProfile(
  resource: FhirResource,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  deps: StructureProfileValidationDeps,
): Promise<ValidationIssue[]> {
  logger.debug('[RecordsValidator] Checking structure profile', profileCanonicalMetadata(profileUrl));

  const loadedStructureDef = await loadProfileWithSnapshot(
    deps.sdLoader,
    deps.profileCache,
    deps.snapshotGenerator,
    profileUrl,
    fhirVersion,
  );

  if (!loadedStructureDef) {
    logger.warn('[RecordsValidator] Failed to load structure profile', profileCanonicalMetadata(profileUrl));
    return [];
  }

  if (!loadedStructureDef.snapshot?.element) {
    return [];
  }

  const incompatibleProfileType = getIncompatibleProfileResourceType(
    loadedStructureDef,
    resource.resourceType,
  );
  if (incompatibleProfileType) {
    return [
      createProfileResourceTypeMismatchIssue(
        profileUrl,
        resource.resourceType,
        incompatibleProfileType,
      ),
    ];
  }

  const requiredFieldIssues = await deps.structuralExecutor.validateRequiredFields(
    resource,
    loadedStructureDef,
    profileUrl,
    getValueAtPath,
    fhirVersion,
  );
  const { validateChoiceTypeProperties } = await import(
    '../validators/choice-type-property-validator.js'
  );

  return [
    ...requiredFieldIssues,
    ...validateChoiceTypeProperties(resource, loadedStructureDef),
  ];
}
