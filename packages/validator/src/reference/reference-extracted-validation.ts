import type { ValidationIssue } from '../types';
import { validateReferenceFormat } from './reference-format-validator';
import { getReferenceFieldName } from './reference-recursive-issues';
import { createReferenceValidationIssue } from './reference-utils';

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
    const formatResult = validateReferenceFormat(reference);
    if (!formatResult.isValid || !formatResult.resourceType || !formatResult.resourceId) {
      return formatResult.issues;
    }

    return [
      ...formatResult.issues,
      ...validateReferenceTypeConstraintIssue(reference, path, resourceType, constraintValidator),
    ];
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
