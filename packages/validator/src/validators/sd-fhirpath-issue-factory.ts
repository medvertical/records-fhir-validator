import type { ValidationIssue } from '@records-fhir/validation-types';
import type { Constraint } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import { getErrorMessage } from '../utils/error-utils.js';

export function createConstraintViolation(
  constraint: Constraint,
  path: string,
  resourceType: string,
  profileUrl?: string,
): ValidationIssue {
  return createValidationIssue({
    code: `constraint-violation-${constraint.key}`,
    path,
    resourceType,
    profile: profileUrl,
    customMessage: constraint.human || `Constraint ${constraint.key} failed: ${constraint.expression}`,
    severityOverride: constraint.severity === 'error' ? 'error' : 'warning',
    ruleId: constraint.key,
    details: {
      expression: constraint.expression,
      constraintKey: constraint.key,
      originalSeverity: constraint.severity,
    },
  });
}

export function createConstraintEvaluationError(
  constraint: Constraint,
  path: string,
  resourceType: string,
  error: unknown,
  profileUrl?: string,
): ValidationIssue {
  const message = getEvaluationErrorMessage(error);
  return createValidationIssue({
    code: 'profile-constraint-evaluation-error',
    path,
    resourceType,
    profile: profileUrl,
    customMessage:
      `Constraint '${constraint.key}' could not be evaluated: ${message}. ` +
      'The underlying data was NOT checked against this constraint.',
    severityOverride: 'information',
    ruleId: constraint.key,
    details: {
      expression: constraint.expression,
      constraintKey: constraint.key,
      evaluationError: message,
      // The data was not checked, so the result is incomplete rather than
      // conformant; the quality lanes read this to tell the two apart.
      validationStatus: 'incomplete',
    },
  });
}

export function getEvaluationErrorMessage(error: unknown): string {
  return getErrorMessage(error);
}

export function isUnsupportedAsyncFHIRPathError(error: unknown): boolean {
  const message = getEvaluationErrorMessage(error).toLowerCase();
  return (
    message.includes('asynchronous function') ||
    message.includes('async function')
  ) && message.includes('not allowed');
}
