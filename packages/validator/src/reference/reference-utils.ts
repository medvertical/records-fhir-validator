/**
 * Reference Validation Utilities
 * 
 * Common utility functions for reference validation.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get field value from resource using dot notation path
 */
export function getFieldValue(resource: any, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let value = resource;
  
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  
  return value;
}

/**
 * Parse error location from field path
 */
export function parseErrorLocation(fieldPath: string): any {
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
  details?: any;
  resourceType?: string;
  schemaVersion?: string;
}): ValidationIssue {
  return {
    id: `reference-${params.code}-${Date.now()}`,
    aspect: 'references',
    severity: params.severity,
    code: params.code,
    message: params.message,
    path: params.path || '',
    humanReadable: params.humanReadable,
    details: params.details || {},
    validationMethod: 'reference-validation',
    timestamp: new Date().toISOString(),
    resourceType: params.resourceType || 'Unknown',
    schemaVersion: params.schemaVersion || 'R4'
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

