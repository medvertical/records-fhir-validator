import type { ValidationIssue } from '@records-fhir/validation-types';

export function validationIssue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    id: Math.random().toString(36),
    aspect: 'profile',
    severity: 'error',
    code: 'profile-slice-min-cardinality',
    message: 'missing slice',
    path: 'Observation.referenceRange',
    timestamp: new Date(),
    ...overrides,
  } as ValidationIssue;
}
