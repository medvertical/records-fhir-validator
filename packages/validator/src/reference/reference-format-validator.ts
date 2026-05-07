/**
 * Reference Format Validator
 * 
 * Validates the format and structure of FHIR references.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '../types';
import type { ReferenceFormatValidation } from './reference-types';

function extractInstanceReferenceFromPath(pathname: string): {
  resourceType?: string;
  resourceId?: string;
  version?: string;
} {
  const pathParts = pathname.split('/').filter(p => p);
  if (pathParts.length < 2) return {};

  if (pathParts.length >= 4 && pathParts[pathParts.length - 2] === '_history') {
    return {
      resourceType: pathParts[pathParts.length - 4],
      resourceId: pathParts[pathParts.length - 3],
      version: pathParts[pathParts.length - 1],
    };
  }

  return {
    resourceType: pathParts[pathParts.length - 2],
    resourceId: pathParts[pathParts.length - 1],
  };
}

// ============================================================================
// Reference Format Validation
// ============================================================================

/**
 * Validate reference format and extract components
 */
// eslint-disable-next-line max-lines-per-function
export function validateReferenceFormat(reference: string): ReferenceFormatValidation {
  const issues: ValidationIssue[] = [];
  let referenceType: 'relative' | 'absolute' | 'logical' | 'contained' | 'invalid' = 'invalid';
  let resourceType: string | undefined;
  let resourceId: string | undefined;
  let version: string | undefined;

  // Check for empty reference
  if (!reference || reference.trim() === '') {
    issues.push({
      id: `reference-empty-${Date.now()}`,
      aspect: 'references',
      severity: 'error',
      code: 'empty-reference',
      message: 'Reference cannot be empty',
      path: '',
      humanReadable: 'The reference field is empty',
      details: { reference },
      validationMethod: 'reference-format-validation',
      timestamp: new Date().toISOString(),
      resourceType: 'Unknown',
      schemaVersion: 'R4'
    });
    return { isValid: false, referenceType: 'invalid', issues };
  }

  // Contained reference: #id
  if (reference.startsWith('#')) {
    referenceType = 'contained';
    resourceId = reference.substring(1);

    if (!resourceId) {
      issues.push({
        id: `reference-invalid-contained-${Date.now()}`,
        aspect: 'references',
        severity: 'error',
        code: 'invalid-contained-reference',
        message: 'Contained reference must have an id after #',
        path: '',
        humanReadable: 'Contained reference format: #id',
        details: { reference },
        validationMethod: 'reference-format-validation',
        timestamp: new Date().toISOString(),
        resourceType: 'Unknown',
        schemaVersion: 'R4'
      });
      return { isValid: false, referenceType: 'contained', issues };
    }

    return { isValid: true, referenceType: 'contained', resourceId, issues };
  }

  // Absolute URL reference
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    referenceType = 'absolute';

    try {
      const url = new URL(reference);
      ({ resourceType, resourceId, version } = extractInstanceReferenceFromPath(url.pathname));
    } catch (error) {
      issues.push({
        id: `reference-invalid-url-${Date.now()}`,
        aspect: 'references',
        severity: 'error',
        code: 'invalid-reference-url',
        message: `Invalid URL in reference: ${reference}`,
        path: '',
        humanReadable: 'The reference URL is malformed',
        details: { reference, error: String(error) },
        validationMethod: 'reference-format-validation',
        timestamp: new Date().toISOString(),
        resourceType: 'Unknown',
        schemaVersion: 'R4'
      });
      return { isValid: false, referenceType: 'absolute', issues };
    }

    return { isValid: true, referenceType: 'absolute', resourceType, resourceId, version, issues };
  }

  // Logical identifier (urn:uuid: or urn:oid:)
  if (reference.startsWith('urn:')) {
    referenceType = 'logical';
    return { isValid: true, referenceType: 'logical', issues };
  }

  // Conditional reference: ResourceType?search-params (used in transaction bundles)
  if (/^[A-Z][a-zA-Z]+\?.+$/.test(reference)) {
    referenceType = 'relative'; // conditional refs are a form of relative reference
    resourceType = reference.split('?')[0];
    return { isValid: true, referenceType, resourceType, issues };
  }

  // Relative reference: ResourceType/id or ResourceType/id/_history/version
  const relativePattern = /^([A-Z][a-zA-Z]+)\/([A-Za-z0-9\-.]+)(?:\/_history\/([A-Za-z0-9\-.]+))?$/;
  const match = reference.match(relativePattern);

  if (match) {
    referenceType = 'relative';
    resourceType = match[1];
    resourceId = match[2];
    version = match[3];

    return { isValid: true, referenceType: 'relative', resourceType, resourceId, version, issues };
  }

  // Invalid format
  issues.push({
    id: `reference-invalid-format-${Date.now()}`,
    aspect: 'references',
    severity: 'error',
    code: 'invalid-reference-format',
    message: `Invalid reference format: ${reference}`,
    path: '',
    humanReadable: 'Reference must be in format: ResourceType/id, http://server/ResourceType/id, #containedId, or urn:uuid:...',
    details: { reference },
    validationMethod: 'reference-format-validation',
    timestamp: new Date().toISOString(),
    resourceType: 'Unknown',
    schemaVersion: 'R4'
  });

  return { isValid: false, referenceType: 'invalid', issues };
}

/**
 * Extract all references from a resource
 */
export function extractReferences(resource: any, resourceType: string): Array<{ path: string, reference: string }> {
  const references: Array<{ path: string, reference: string }> = [];

  function traverse(obj: any, currentPath: string = '') {
    if (!obj || typeof obj !== 'object') return;

    // Check if current object is a Reference
    if (obj.reference && typeof obj.reference === 'string') {
      references.push({
        path: currentPath,
        reference: obj.reference
      });
    }

    // Traverse arrays
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        traverse(item, `${currentPath}[${index}]`);
      });
    }
    // Traverse objects
    else {
      for (const [key, value] of Object.entries(obj)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        traverse(value, newPath);
      }
    }
  }

  traverse(resource, resourceType);
  return references;
}
