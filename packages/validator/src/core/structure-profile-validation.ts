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
  isUsableResourceBaseProfile,
} from './profile-resource-type.js';
import { getValueAtPath } from './validation-utils.js';
import { createProfileUnreadable } from '../issues/profile-completeness-issues.js';

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

  let loadedStructureDef = await loadProfileWithSnapshot(
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

  const incompatibleProfileType = getIncompatibleProfileResourceType(
    loadedStructureDef,
    resource.resourceType,
    fhirVersion,
  );
  const issues: ValidationIssue[] = [];
  let effectiveProfileUrl = profileUrl;
  if (incompatibleProfileType) {
    effectiveProfileUrl = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    try {
      loadedStructureDef = await loadProfileWithSnapshot(
        deps.sdLoader, deps.profileCache, deps.snapshotGenerator, effectiveProfileUrl, fhirVersion,
      );
    } catch (error: unknown) {
      return [
        createProfileResourceTypeMismatchIssue(profileUrl, resource.resourceType, incompatibleProfileType, false),
        createProfileUnreadable({ profileUrl: effectiveProfileUrl, resourceType: resource.resourceType,
          reason: 'structural-profile', error }),
      ];
    }
    const usableBase = isUsableResourceBaseProfile(loadedStructureDef, resource.resourceType, fhirVersion);
    issues.push(createProfileResourceTypeMismatchIssue(
      profileUrl, resource.resourceType, incompatibleProfileType, usableBase,
    ));
    if (!usableBase) return issues;
  }
  if (!loadedStructureDef?.snapshot?.element) return issues;

  const requiredFieldIssues = await deps.structuralExecutor.validateRequiredFields(
    resource,
    loadedStructureDef,
    effectiveProfileUrl,
    getValueAtPath,
    fhirVersion,
  );
  const { validateChoiceTypeProperties } = await import(
    '../validators/choice-type-property-validator.js'
  );

  return [
    ...issues,
    ...requiredFieldIssues,
    ...validateChoiceTypeProperties(resource, loadedStructureDef),
  ];
}
