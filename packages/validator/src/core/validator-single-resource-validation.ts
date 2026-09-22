import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { createValidationErrorIssue } from './validation-utils.js';
import { withIssuesSchemaVersion } from './issue-schema-version.js';
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
    settings,
    fhirClient,
    referenceResolver,
    bundleCanonicalResolver,
    organizationId,
    serverId,
  } = input;
  const startTime = Date.now();
  const executionInput: RecordsSingleResourceValidationInput = {
    resource,
    profileUrl,
    fhirVersion,
    settings,
    fhirClient,
    referenceResolver,
    bundleCanonicalResolver,
    organizationId,
    serverId,
  };

  try {
    const issues = await executeRecordsResourceValidation(executionInput, context, startTime);
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
