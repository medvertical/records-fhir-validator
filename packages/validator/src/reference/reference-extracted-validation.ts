import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateReferenceFormat } from './reference-format-validator.js';
import { getReferenceFieldName } from './reference-recursive-issues.js';
import { createReferenceValidationIssue } from './reference-utils.js';

interface ReferenceTypeConstraintValidator {
  validateReferenceType(reference: string, resourceType: string, fieldPath: string): {
    isValid: boolean;
    severity?: 'fatal' | 'error' | 'warning' | 'info' | 'information' | 'inherit';
    code?: string;
    message: string;
    actualType?: string | null;
    expectedTypes?: string[];
  };
}

export interface ExtractedReference {
  path: string;
  reference: string;
}

export function validateExtractedReferences(
  extractedRefs: ExtractedReference[],
  resourceType: string,
  constraintValidator: ReferenceTypeConstraintValidator,
): ValidationIssue[] {
  return extractedRefs.flatMap(({ path, reference }) => {
    const formatResult = validateReferenceFormat(reference, {
      path: `${path}.reference`,
      resourceType,
    });
    if (!formatResult.isValid || !formatResult.resourceType) {
      return annotateReferenceFormatIssues(formatResult.issues, path, reference, resourceType);
    }

    return [
      ...annotateReferenceFormatIssues(formatResult.issues, path, reference, resourceType),
      ...validateReferenceTypeConstraintIssue(reference, path, resourceType, constraintValidator),
    ];
  });
}

function annotateReferenceFormatIssues(
  issues: ValidationIssue[],
  path: string,
  reference: string,
  resourceType: string,
): ValidationIssue[] {
  return issues.map(issue => {
    const details = issue.details && typeof issue.details === 'object'
      ? issue.details as Record<string, unknown>
      : {};

    return {
      ...issue,
      path: issue.path || `${path}.reference`,
      resourceType: issue.resourceType && issue.resourceType !== 'Unknown'
        ? issue.resourceType
        : resourceType,
      details: {
        ...details,
        reference,
        fieldPath: path,
      },
    };
  });
}

function validateReferenceTypeConstraintIssue(
  reference: string,
  path: string,
  resourceType: string,
  constraintValidator: ReferenceTypeConstraintValidator,
): ValidationIssue[] {
  const fieldName = getReferenceFieldName(path);
  const constraintResult = constraintValidator.validateReferenceType(reference, resourceType, fieldName);

  if (
    constraintResult.isValid ||
    (constraintResult.severity !== 'error' && constraintResult.severity !== 'warning')
  ) {
    return [];
  }

  return [createReferenceValidationIssue({
    code: constraintResult.code || 'reference-type-mismatch',
    severity: constraintResult.severity,
    message: constraintResult.message,
    humanReadable: `Reference at ${path} points to ${constraintResult.actualType || 'unknown'} but expected ${constraintResult.expectedTypes?.join(' or ') || 'different type'}`,
    path,
    details: {
      reference,
      actualType: constraintResult.actualType,
      expectedTypes: constraintResult.expectedTypes,
      fieldPath: fieldName,
    },
    resourceType,
  })];
}
