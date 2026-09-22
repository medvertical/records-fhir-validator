import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createSafeValidationFailureMessage } from '../utils/validation-execution-failure.js';

export function handleBundleValidationFailure(): ValidationIssue {
  logger.error('[BundleValidator] Bundle validation failed');
  return createValidationIssue({
    code: 'bundle-validation-error',
    path: 'Bundle',
    resourceType: 'Bundle',
    customMessage: createSafeValidationFailureMessage('Bundle validation'),
    severityOverride: 'error',
  });
}
