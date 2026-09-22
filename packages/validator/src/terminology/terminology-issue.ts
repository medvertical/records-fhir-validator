import type {
  ValidationIssue,
  ValidationSeverity,
} from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

export interface TerminologyIssueInput {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path: string;
  resourceType?: string;
  profile?: string;
  humanReadable?: string;
  details?: Record<string, unknown>;
  schemaVersion?: 'R4' | 'R5' | 'R6';
}

export function createTerminologyIssue(
  input: TerminologyIssueInput,
): ValidationIssue {
  const issue = createValidationIssue({
    code: input.code,
    path: input.path,
    resourceType: input.resourceType ?? resourceTypeFromPath(input.path),
    severityOverride: input.severity,
    aspectOverride: 'terminology',
    customMessage: input.message,
    profile: input.profile,
    details: input.details,
  });

  return {
    ...issue,
    humanReadable: input.humanReadable ?? input.message,
    validationMethod: 'terminology-validation',
    schemaVersion: input.schemaVersion ?? 'R4',
  };
}

function resourceTypeFromPath(path: string): string {
  const [resourceType] = path.split('.');
  return resourceType || 'Resource';
}
