import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ValidationGraph } from './validation-graph-types.js';

export function createValidationGraphIssue(
  code: string,
  path: string,
  message: string,
  graph?: ValidationGraph,
): ValidationIssue {
  return {
    aspect: 'profile',
    severity: 'error',
    code,
    path,
    expression: path,
    message,
    resourceType: graph?.type,
    profile: graph?.url,
    validationMethod: 'fhir-schema-graph',
    timestamp: new Date(),
  };
}

export function isGraphRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
