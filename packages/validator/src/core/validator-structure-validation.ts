import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { createValidationErrorIssue } from './validation-utils.js';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';
import { withIssuesSchemaVersion } from './issue-schema-version.js';
import { getDeclaredProfiles } from './declared-profile-utils.js';
import { createSafeValidationFailureMessage } from '../utils/validation-execution-failure.js';
import { isFhirResource, type FhirResource } from './fhir-resource.js';
import {
  validateStructureProfile,
  type StructureProfileValidationDeps,
} from './structure-profile-validation.js';

interface ValidateStructureDeps extends StructureProfileValidationDeps {
  questionnaireRegistry: QuestionnaireContextRegistry;
  maxBundleEntryDepth: number;
  validateBundleEntries(
    bundle: FhirResource,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number
  ): Promise<ValidationIssue[]>;
}

export async function validateResourceStructure(
  resource: unknown,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: ValidateStructureDeps
): Promise<ValidationIssue[]> {
  const startTime = Date.now();
  const issues: ValidationIssue[] = [];

  try {
    if (!isFhirResource(resource)) {
      return withIssuesSchemaVersion([createValidationErrorIssue(
        'structural',
        'missing-resourcetype',
        'Resource is missing resourceType field',
      )], fhirVersion);
    }

    const declaredProfiles = getDeclaredProfiles(resource);
    const baseUrl = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    const profilesToValidate = declaredProfiles.length > 0 ? declaredProfiles : [baseUrl];

    logger.debug(`[RecordsValidator] Validating ${resource.resourceType} structure against ${profilesToValidate.length} profile(s)`);

    for (const profileUrl of profilesToValidate) {
      issues.push(...await validateStructureProfile(resource, profileUrl, fhirVersion, deps));
    }

    issues.push(...await validatePostStructureRules(resource, fhirVersion, recursionDepth, deps));

    const validationTime = Date.now() - startTime;
    logger.debug(`[RecordsValidator] Validated structure in ${validationTime}ms (${issues.length} issues)`);

    return withIssuesSchemaVersion(issues, fhirVersion);
  } catch {
    logger.error('[RecordsValidator] Structure validation failed');
    return withIssuesSchemaVersion([createValidationErrorIssue(
      'structural',
      'validation-error',
      createSafeValidationFailureMessage('Structure validation'),
    )], fhirVersion);
  }
}

async function validatePostStructureRules(
  resource: FhirResource,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: ValidateStructureDeps
): Promise<ValidationIssue[]> {
  const contextQ = resource.resourceType === 'QuestionnaireResponse'
    ? deps.questionnaireRegistry.resolveForResponse(resource)
    : undefined;

  const issues = [
    ...deps.structuralExecutor.validateResourceIdAndArrays(resource, contextQ, {
      warnOnUnresolvedQuestionnaireReference: true,
    }),
    ...(await deps.structuralExecutor.validateCompliesWith(resource, fhirVersion)),
  ];

  if (resource.resourceType === 'Bundle') {
    issues.push(...await deps.structuralExecutor.validateBundle(resource));

    if (recursionDepth < deps.maxBundleEntryDepth) {
      issues.push(...await deps.validateBundleEntries(resource, fhirVersion, recursionDepth + 1));
    }
  }

  return issues;
}
