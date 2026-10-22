import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { validateContainedResourceTree } from './validator-contained-issues.js';
import { validateParametersResourceTree } from './parameters-resource-validation.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { createValidationErrorIssue } from './validation-utils.js';
import { withIssuesSchemaVersion } from './issue-schema-version.js';
import { applyBestPracticeSeverity } from '../strictness/index.js';
import { isCustomRuleReleaseModelCoherent, normalizeCustomRuleSelectedRelease } from '../custom-rules/applicability.js';
import { createCustomRuleApplicabilityUnknownIssue } from '../custom-rules/applicability-issue.js';
import { resourceTypeOf } from './fhir-resource.js';
import {
  createSafeValidationFailureMessage,
  validationFailureMetadata,
} from '../utils/validation-execution-failure.js';
import {
  executeRecordsResourceValidation,
  type RecordsSingleResourceValidationContext,
  type RecordsSingleResourceValidationInput,
} from './validator-single-resource-pipeline.js';

export async function validateRecordsResource(
  input: RecordsSingleResourceValidationInput,
  context: RecordsSingleResourceValidationContext,
): Promise<ValidationIssue[]> {
  const {
    resource,
    profileUrl,
    fhirVersion,
    selectedRelease,
    settings,
    fhirClient,
    referenceResolver,
    bundleCanonicalResolver,
    enclosingBundle,
    containingResource,
    organizationId,
    serverId,
  } = input;
  if (!isCustomRuleReleaseModelCoherent(selectedRelease, fhirVersion)) {
    return withIssuesSchemaVersion([createCustomRuleApplicabilityUnknownIssue(
      resourceTypeOf(resource), undefined, normalizeCustomRuleSelectedRelease(selectedRelease), 'release-model-mismatch',
    )], fhirVersion);
  }
  const startTime = Date.now();
  const executionInput: RecordsSingleResourceValidationInput = {
    resource,
    profileUrl,
    fhirVersion,
    selectedRelease: selectedRelease === undefined ? fhirVersion : selectedRelease,
    settings,
    fhirClient,
    referenceResolver,
    bundleCanonicalResolver,
    enclosingBundle,
    containingResource,
    organizationId,
    serverId,
  };

  try {
    // The same best-practice severity as batch validation gives its findings,
    // applied before deduplication: a Bundle entry's dom-6, reported from the
    // Bundle and from the entry, differed only by severity.
    const issues = await executeRecordsResourceValidation(executionInput, {
      ...context,
      governIssues: found => applyBestPracticeSeverity(found, settings?.bestPracticeSeverity),
    }, startTime);
    return withIssuesSchemaVersion(issues, fhirVersion);
  } catch (error) {
    logger.error(
      '[RecordsValidator] Validation failed',
      validationFailureMetadata(error),
    );
    return withIssuesSchemaVersion([createValidationErrorIssue(
      'profile',
      'validation-error',
      createSafeValidationFailureMessage('Validation'),
    )], fhirVersion);
  }
}

export function createSingleResourceRecursiveValidation(
  input: RecordsSingleResourceValidationInput,
  context: {
    recursionDepth: number;
    maxDepth: number;
    skipEmbeddedValidation?: boolean;
    validate(input: RecordsSingleResourceValidationInput, recursionDepth: number, skipEmbeddedValidation?: boolean): Promise<ValidationIssue[]>;
  },
): Pick<RecordsSingleResourceValidationContext,
  'validateContainedResourcesIfNeeded' | 'validateParametersResourcesIfNeeded' | 'validateAgainstProfile'> {
  const validateEmbedded = (
    resource: FhirResourceRecord, profileUrl: string, recursionDepth: number,
    containingResource: Record<string, unknown>, skipEmbeddedValidation = false,
  ) => context.validate({ ...input, resource, profileUrl, containingResource }, recursionDepth, skipEmbeddedValidation);
  return {
    validateContainedResourcesIfNeeded: target => context.skipEmbeddedValidation ? Promise.resolve([]) : validateContainedResourceTree(target, {
      recursionDepth: context.recursionDepth, maxDepth: context.maxDepth,
      validate: (embedded, profile, nextDepth, skipEmbeddedValidation = false) =>
        validateEmbedded(embedded, profile, nextDepth, target, skipEmbeddedValidation),
    }),
    validateParametersResourcesIfNeeded: target => context.skipEmbeddedValidation ? Promise.resolve([]) : validateParametersResourceTree(target, {
      recursionDepth: context.recursionDepth, maxDepth: context.maxDepth,
      validate: (embedded, profile, nextDepth, skipEmbeddedValidation = false) =>
        validateEmbedded(embedded, profile, nextDepth, embedded, skipEmbeddedValidation),
    }),
    validateAgainstProfile: (target, profile) =>
      validateEmbedded(target, profile, context.recursionDepth, input.containingResource ?? target, true),
  };
}
