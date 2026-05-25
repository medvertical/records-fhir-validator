/**
 * Element Path Resolver Utility
 * 
 * Provides utilities for parsing and resolving FHIR element paths.
 * Used to determine parent-child relationships and check element existence
 * for conditional cardinality validation.
 * 
 * Key Responsibilities:
 * - Parse element paths into components
 * - Get parent paths from child paths
 * - Check if parent elements exist in resources
 * - Determine if paths are root-level vs nested
 * 
 * Example Usage:
 * ```typescript
 * // Check if parent exists before requiring child element
 * const parentPath = getParentPath('Patient.communication.language');
 * // Returns: 'Patient.communication'
 * 
 * if (hasParentElement(resource, 'Patient.communication.language')) {
 *   // Parent exists, child element is truly required
 * }
 * ```
 */

// ============================================================================
// Types
// ============================================================================

import { logger } from '../logger';

export interface PathComponents {
  /** Full path (e.g., "Patient.communication.language") */
  fullPath: string;

  /** Resource type (e.g., "Patient") */
  resourceType: string;

  /** Path segments without resource type (e.g., ["communication", "language"]) */
  segments: string[];

  /** Parent path, if any (e.g., "Patient.communication") */
  parentPath: string | null;

  /** Whether this is a root-level element (e.g., "Patient.name") */
  isRootLevel: boolean;

  /** Depth level (0 = resourceType, 1 = root element, 2+ = nested) */
  depth: number;
}

// ============================================================================
// Path Parsing Functions
// ============================================================================

/**
 * Parse an element path into components
 * 
 * @param path - Element path (e.g., "Patient.communication.language")
 * @param resourceType - Resource type to validate against (optional)
 * @returns Parsed path components
 * 
 * @example
 * parseElementPath('Patient.communication.language', 'Patient')
 * // Returns:
 * // {
 * //   fullPath: 'Patient.communication.language',
 * //   resourceType: 'Patient',
 * //   segments: ['communication', 'language'],
 * //   parentPath: 'Patient.communication',
 * //   isRootLevel: false,
 * //   depth: 2
 * // }
 */
export function parseElementPath(path: string, resourceType?: string): PathComponents {
  const parts = path.split('.');

  if (parts.length === 0) {
    throw new Error(`Invalid element path: ${path}`);
  }

  const pathResourceType = parts[0];
  const segments = parts.slice(1); // Remove resource type

  // Validate resource type if provided
  if (resourceType && pathResourceType !== resourceType) {
    logger.warn(
      `[ElementPathResolver] Path resource type "${pathResourceType}" ` +
      `doesn't match expected "${resourceType}"`
    );
  }

  // Calculate parent path
  let parentPath: string | null = null;
  if (parts.length > 2) {
    // Has parent (e.g., "Patient.communication.language" -> "Patient.communication")
    parentPath = parts.slice(0, -1).join('.');
  } else if (parts.length === 2) {
    // Root level element - parent is the resource itself
    parentPath = pathResourceType;
  }

  return {
    fullPath: path,
    resourceType: pathResourceType,
    segments,
    parentPath,
    isRootLevel: segments.length === 1,
    depth: segments.length
  };
}

/**
 * Get parent path from a child path
 * 
 * @param path - Child element path
 * @returns Parent path, or null if path is resource type itself
 * 
 * @example
 * getParentPath('Patient.communication.language') // 'Patient.communication'
 * getParentPath('Patient.name') // 'Patient'
 * getParentPath('Patient') // null
 */
export function getParentPath(path: string): string | null {
  const parts = path.split('.');

  if (parts.length <= 1) {
    // Resource type itself - no parent
    return null;
  }

  // Return all parts except the last
  return parts.slice(0, -1).join('.');
}

/**
 * Check if a path represents a root-level element
 * 
 * @param path - Element path
 * @param resourceType - Resource type
 * @returns True if element is at root level (e.g., "Patient.name")
 * 
 * @example
 * isRootElement('Patient.name', 'Patient') // true
 * isRootElement('Patient.communication.language', 'Patient') // false
 */
export function isRootElement(path: string, resourceType: string): boolean {
  const parts = path.split('.');

  // Root element: ResourceType.element (exactly 2 parts)
  return parts.length === 2 && parts[0] === resourceType;
}

/**
 * Get all ancestor paths for an element path
 * 
 * @param path - Element path
 * @returns Array of ancestor paths, from immediate parent to root
 * 
 * @example
 * getAncestorPaths('Patient.contact.name.given')
 * // Returns: ['Patient.contact.name', 'Patient.contact', 'Patient']
 */
export function getAncestorPaths(path: string): string[] {
  const parts = path.split('.');
  const ancestors: string[] = [];

  // Build ancestor paths from immediate parent up to root
  for (let i = parts.length - 1; i > 0; i--) {
    ancestors.push(parts.slice(0, i).join('.'));
  }

  return ancestors;
}

// ============================================================================
// Element Existence Checking
// ============================================================================

// Import from canonical source and re-export for backwards compatibility
import { getValueAtPath } from '../core/validation-utils';
export { getValueAtPath };
export {
  expandPathWithArrayIndex,
  getValidationTargets,
  isArrayAtPath,
  type ValidationTarget,
} from './element-validation-targets';

/**
 * Check if parent element exists in resource
 * 
 * This is the core function for conditional cardinality checking.
 * Returns true if:
 * - Element is root-level (no parent beyond resource itself)
 * - Parent element exists and is not null/undefined
 * - Parent is an array with at least one element
 * 
 * @param resource - FHIR resource
 * @param elementPath - Path of the child element to check
 * @returns True if parent exists (or element is root-level), false otherwise
 * 
 * @example
 * // Patient without communication
 * hasParentElement(patient, 'Patient.communication.language') // false
 * 
 * // Patient with communication
 * hasParentElement(patientWithComm, 'Patient.communication.language') // true
 * 
 * // Root element always returns true
 * hasParentElement(patient, 'Patient.name') // true
 */
export function hasParentElement(resource: any, elementPath: string): boolean {
  if (!resource || typeof resource !== 'object') {
    return false;
  }

  // Get parent path
  const parentPath = getParentPath(elementPath);

  if (!parentPath) {
    return true;
  }

  if (parentPath === resource.resourceType) {
    return true;
  }

  const parentValue = getValueAtPath(resource, parentPath);

  if (parentValue === undefined || parentValue === null) {
    return false;
  }

  if (Array.isArray(parentValue)) {
    return parentValue.length > 0;
  }

  return true;
}

/**
 * Check if any parent in the ancestor chain is missing
 * 
 * This recursively checks all ancestors to ensure the entire
 * path is valid before requiring a child element.
 * 
 * @param resource - FHIR resource
 * @param elementPath - Element path to check
 * @returns True if all ancestors exist, false if any are missing
 * 
 * @example
 * // Check if Patient.contact.name.given requires validation
 * // Checks: Patient.contact exists, Patient.contact.name exists
 * hasAllAncestors(patient, 'Patient.contact.name.given')
 */
export function hasAllAncestors(resource: any, elementPath: string): boolean {
  const ancestors = getAncestorPaths(elementPath);

  // Check each ancestor
  for (const ancestorPath of ancestors) {
    // Skip resource type check
    if (ancestorPath === resource.resourceType) {
      continue;
    }

    const ancestorValue = getValueAtPath(resource, ancestorPath);

    // If any ancestor is missing, return false
    if (ancestorValue === undefined || ancestorValue === null) {
      return false;
    }

    // For arrays, must have at least one element
    if (Array.isArray(ancestorValue) && ancestorValue.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Check if element should be validated for required cardinality
 * 
 * Combines parent existence check with root-level detection to determine
 * if a required element validation should be enforced.
 * 
 * @param resource - FHIR resource
 * @param elementPath - Element path
 * @returns True if element should be validated as required
 * 
 * @example
 * shouldValidateRequired(patient, 'Patient.name') // true (root level)
 * shouldValidateRequired(patient, 'Patient.communication.language') 
 *   // true only if patient.communication exists
 */
export function shouldValidateRequired(resource: any, elementPath: string): boolean {
  // Root-level elements are always validated
  if (isRootElement(elementPath, resource.resourceType)) {
    return true;
  }

  // Nested elements: only validate if parent exists
  return hasParentElement(resource, elementPath);
}

// ============================================================================
// Debugging Utilities
// ============================================================================

/**
 * Get detailed path information for debugging
 * 
 * @param resource - FHIR resource
 * @param elementPath - Element path
 * @returns Debug information about the path
 */
export function getPathDebugInfo(resource: any, elementPath: string): {
  path: string;
  components: PathComponents;
  valueExists: boolean;
  parentExists: boolean;
  shouldValidate: boolean;
  value: any;
  parentValue: any;
} {
  const components = parseElementPath(elementPath, resource.resourceType);
  const value = getValueAtPath(resource, elementPath);
  const parentPath = getParentPath(elementPath);
  const parentValue = parentPath ? getValueAtPath(resource, parentPath) : resource;

  return {
    path: elementPath,
    components,
    valueExists: value !== undefined && value !== null,
    parentExists: hasParentElement(resource, elementPath),
    shouldValidate: shouldValidateRequired(resource, elementPath),
    value,
    parentValue
  };
}
