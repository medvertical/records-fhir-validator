import type { ValidationIssue } from '@records-fhir/validation-types';
import { createSafeValidationFailureMessage } from '../../utils/validation-execution-failure.js';
import { createValidationErrorIssue } from '../core-validation-issue.js';

export function createExecutorFailureIssue(
  aspect: ValidationIssue['aspect'],
  label: string,
  path?: string,
  details?: Record<string, unknown>,
): ValidationIssue {
  return createValidationErrorIssue(
    aspect,
    'validation-error',
    createSafeValidationFailureMessage(`${label} validation`),
    details,
    path,
  );
}
