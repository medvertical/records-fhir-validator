import type { ValidationIssue } from '@records-fhir/validation-types';

export type EngineFhirVersion = 'R4' | 'R5' | 'R6';

export function withIssueSchemaVersion<T extends ValidationIssue>(
  issue: T,
  fhirVersion: EngineFhirVersion,
): T {
  return {
    ...issue,
    schemaVersion: fhirVersion,
  };
}

export function withIssuesSchemaVersion<T extends ValidationIssue>(
  issues: T[],
  fhirVersion: EngineFhirVersion,
): T[] {
  return issues.map(issue => withIssueSchemaVersion(issue, fhirVersion));
}
