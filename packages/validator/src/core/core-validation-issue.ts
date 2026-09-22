import { computeValidationIssueId } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

export function createValidationErrorIssue(
  aspect: ValidationIssue['aspect'],
  code: string,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): ValidationIssue {
  return createCoreValidationIssue(aspect, 'error', code, message, details, path);
}

export function createValidationInfoIssue(
  aspect: ValidationIssue['aspect'],
  code: string,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): ValidationIssue {
  return createCoreValidationIssue(aspect, 'info', code, message, details, path);
}

export function createValidationWarningIssue(
  aspect: ValidationIssue['aspect'],
  code: string,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): ValidationIssue {
  return createCoreValidationIssue(aspect, 'warning', code, message, details, path);
}

function createCoreValidationIssue(
  aspect: ValidationIssue['aspect'],
  severity: 'error' | 'info' | 'warning',
  code: string,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): ValidationIssue {
  const normalizedPath = path ?? '';
  return {
    id: computeValidationIssueId({
      aspect,
      severity,
      code,
      message,
      path: normalizedPath,
      details,
    }),
    aspect,
    severity,
    code,
    message,
    path: normalizedPath,
    timestamp: new Date(),
    ...(details && { details }),
  };
}
