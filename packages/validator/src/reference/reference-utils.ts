/**
 * Reference Validation Utilities
 * 
 * Common utility functions for reference validation.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get field value from resource using dot notation path
 */
export function getFieldValue(resource: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let value: unknown = resource;
  
  for (const part of parts) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    value = record[part];
  }
  
  return value;
}

/**
 * Parse error location from field path
 */
export function parseErrorLocation(fieldPath: string): { line: string; column: number } {
  const parts = fieldPath.split('.');
  return {
    line: parts.join('.'),
    column: 0
  };
}

/**
 * Create validation issue for reference validation
 */
export function createReferenceValidationIssue(params: {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  humanReadable: string;
  path?: string;
  details?: Record<string, unknown>;
  resourceType?: string;
  schemaVersion?: string;
}): ValidationIssue {
  const issue = createValidationIssue({
    code: params.code,
    path: params.path ?? '',
    resourceType: params.resourceType ?? 'Unknown',
    severityOverride: params.severity,
    aspectOverride: 'reference',
    customMessage: params.message,
    details: params.details,
  });
  return {
    ...issue,
    humanReadable: params.humanReadable,
    validationMethod: 'reference-validation',
    schemaVersion: params.schemaVersion ?? 'R4',
  };
}

/**
 * Check if a reference is required based on field definition
 */
export function isRequiredReferenceField(
  fieldPath: string,
  referenceFieldDefinitions: Array<{path: string, required?: boolean}>
): boolean {
  const definition = referenceFieldDefinitions.find(def => 
    fieldPath.includes(def.path)
  );
  return definition?.required || false;
}

/**
 * Get target resource types for a reference field
 */
export function getTargetResourceTypes(
  fieldPath: string,
  referenceFieldDefinitions: Array<{path: string, targetTypes?: string[]}>
): string[] | undefined {
  const definition = referenceFieldDefinitions.find(def => 
    fieldPath.includes(def.path)
  );
  return definition?.targetTypes;
}
