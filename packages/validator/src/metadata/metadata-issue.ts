import { computeValidationIssueId } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

export interface MetadataIssueInput {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path: string;
  humanReadable: string;
  resourceType: string;
  validationMethod: string;
  schemaVersion?: 'R4' | 'R5' | 'R6';
  details?: Record<string, unknown>;
}

export function createMetadataIssue(input: MetadataIssueInput): ValidationIssue {
  const details = {
    fieldPath: input.path,
    resourceType: input.resourceType,
    validationType: input.validationMethod,
    ...input.details,
  };
  return {
    id: computeValidationIssueId({
      aspect: 'metadata',
      severity: input.severity,
      code: input.code,
      message: input.message,
      path: input.path,
      resourceType: input.resourceType,
      details,
    }),
    aspect: 'metadata',
    severity: input.severity,
    code: input.code,
    message: input.message,
    path: input.path,
    humanReadable: input.humanReadable,
    details,
    validationMethod: input.validationMethod,
    timestamp: new Date().toISOString(),
    resourceType: input.resourceType,
    schemaVersion: input.schemaVersion ?? 'R4',
  };
}
