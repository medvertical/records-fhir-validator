import type { ValidationIssue } from '../types';
import { logger } from '../logger';
import { getValueAtPath, createValidationErrorIssue } from './validation-utils';
import { loadProfileWithSnapshot } from './profile-loader-utils';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { ProfileCache } from '../cache/profile-cache';
import type { SnapshotGenerator } from './snapshot-generator';
import type { StructuralExecutor } from './executors';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry';
import {
  createProfileResourceTypeMismatchIssue,
  getIncompatibleProfileResourceType,
} from './profile-resource-type';

interface ValidateStructureDeps {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  questionnaireRegistry: QuestionnaireContextRegistry;
  maxBundleEntryDepth: number;
  validateBundleEntries(
    bundle: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number
  ): Promise<ValidationIssue[]>;
}

export async function validateResourceStructure(
  resource: any,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: ValidateStructureDeps
): Promise<ValidationIssue[]> {
  const startTime = Date.now();
  const issues: ValidationIssue[] = [];

  try {
    if (!resource.resourceType) {
      return [{
        id: `records-missing-resourcetype-${Date.now()}`,
        aspect: 'structural',
        severity: 'error',
        code: 'missing-resourcetype',
        message: 'Resource is missing resourceType field',
        path: '',
        timestamp: new Date()
      }];
    }

    const declaredProfiles = resource.meta?.profile || [];
    const baseUrl = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    const profilesToValidate = declaredProfiles.length > 0 ? declaredProfiles : [baseUrl];

    logger.info(`[RecordsValidator] Validating ${resource.resourceType} structure against ${profilesToValidate.length} profile(s)`);

    for (const profileUrl of profilesToValidate) {
      issues.push(...await validateStructureProfile(resource, profileUrl, fhirVersion, deps));
    }

    issues.push(...await validatePostStructureRules(resource, fhirVersion, recursionDepth, deps));

    const validationTime = Date.now() - startTime;
    logger.info(`[RecordsValidator] Validated structure in ${validationTime}ms (${issues.length} issues)`);

    return issues;
  } catch (error) {
    logger.error('[RecordsValidator] Structure validation error:', error);
    return [createValidationErrorIssue(
      'structural',
      'validation-error',
      `Structure validation failed: ${error instanceof Error ? error.message : String(error)}`
    )];
  }
}

async function validateStructureProfile(
  resource: any,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  deps: ValidateStructureDeps
): Promise<ValidationIssue[]> {
  logger.info(`[RecordsValidator]   - Checking profile: ${profileUrl}`);

  const loadedStructureDef = await loadProfileWithSnapshot(
    deps.sdLoader,
    deps.profileCache,
    deps.snapshotGenerator,
    profileUrl,
    fhirVersion
  );

  if (!loadedStructureDef) {
    logger.warn(`[RecordsValidator] Failed to load profile: ${profileUrl}`);
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
    fhirVersion
  );
  const { validateChoiceTypeProperties } = await import(
    '../validators/choice-type-property-validator.js'
  );

  return [
    ...requiredFieldIssues,
    ...validateChoiceTypeProperties(resource, loadedStructureDef),
  ];
}

async function validatePostStructureRules(
  resource: any,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: ValidateStructureDeps
): Promise<ValidationIssue[]> {
  const contextQ = resource.resourceType === 'QuestionnaireResponse'
    ? deps.questionnaireRegistry.resolveForResponse(resource)
    : undefined;

  const issues = [
    ...deps.structuralExecutor.validateResourceIdAndArrays(resource, contextQ),
    ...(await deps.structuralExecutor.validateCompliesWith(resource, fhirVersion)),
  ];

  if (resource.resourceType === 'Bundle') {
    const { bundleValidator } = await import('../validators/bundle-validator.js');
    issues.push(...await bundleValidator.validateBundle(resource));

    if (recursionDepth < deps.maxBundleEntryDepth) {
      issues.push(...await deps.validateBundleEntries(resource, fhirVersion, recursionDepth + 1));
    }
  }

  return issues;
}
