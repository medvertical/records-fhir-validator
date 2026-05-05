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

// ============================================================================
// Array-Aware Path Utilities
// ============================================================================

/**
 * Check if the value at a given path is an array
 * 
 * @param resource - FHIR resource
 * @param path - Element path
 * @returns True if the value at the path is an array
 * 
 * @example
 * isArrayAtPath(patient, 'Patient.identifier') // true if identifier is array
 * isArrayAtPath(patient, 'Patient.name') // true if name is array
 * isArrayAtPath(patient, 'Patient.gender') // false (single value)
 */
export function isArrayAtPath(resource: any, path: string): boolean {
  // getValueAtPath unwraps single-element arrays, so we check the raw property
  // to correctly detect whether the field is defined as an array.
  const parts = path.split('.');
  if (parts[0] === resource?.resourceType) {
    parts.shift();
  }
  let current: any = resource;
  for (const part of parts) {
    if (current == null) return false;
    if (Array.isArray(current)) {
      current = current[0];
      if (current == null) return false;
    }
    let value = current[part];
    // Handle FHIR choice types (e.g. value[x] → valueCoding)
    if (value === undefined && part.endsWith('[x]') && typeof current === 'object') {
      const prefix = part.slice(0, -3);
      const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
      if (actualKey) value = current[actualKey];
    }
    current = value;
  }
  return Array.isArray(current);
}

/**
 * Expand a path by inserting an array index
 * 
 * @param path - Original path (e.g., "Patient.identifier.system")
 * @param arraySegment - Segment that is an array (e.g., "identifier")
 * @param index - Array index
 * @returns Expanded path with index (e.g., "Patient.identifier[0].system")
 * 
 * @example
 * expandPathWithArrayIndex('Patient.identifier.system', 'identifier', 0)
 * // Returns: 'Patient.identifier[0].system'
 */
export function expandPathWithArrayIndex(
  path: string,
  arraySegment: string,
  index: number
): string {
  const parts = path.split('.');
  const expandedParts: string[] = [];

  for (const part of parts) {
    if (part === arraySegment) {
      expandedParts.push(`${part}[${index}]`);
    } else {
      expandedParts.push(part);
    }
  }

  return expandedParts.join('.');
}

/**
 * Validation target for a specific path in a resource
 * Includes the value, full path with array indices, and context path for parent checking
 */
export interface ValidationTarget {
  /** Value at the target path */
  value: any;

  /** Full path including array indices (e.g., "Patient.identifier[0].system") */
  fullPath: string;

  /** Context path for parent existence checking (e.g., "Patient.identifier[0]") */
  contextPath: string;

  /** Whether this target is within an array element */
  isArrayElement: boolean;

  /** Array index if this is an array element */
  arrayIndex?: number;
}

/**
 * Get all validation targets for a path, expanding arrays
 * 
 * This is the core function for array-aware validation. It takes a path like
 * "Patient.identifier.system" and expands it to validate each array element:
 * - Patient.identifier[0].system
 * - Patient.identifier[1].system
 * - etc.
 * 
 * @param resource - FHIR resource
 * @param path - Element path (may contain arrays)
 * @returns Array of validation targets, one per array element (or single target if no arrays)
 * 
 * @example
 * // Patient with 2 identifiers
 * getValidationTargets(patient, 'Patient.identifier.system')
 * // Returns:
 * // [
 * //   { value: "http://...", fullPath: "Patient.identifier[0].system", contextPath: "Patient.identifier[0]", isArrayElement: true, arrayIndex: 0 },
 * //   { value: undefined, fullPath: "Patient.identifier[1].system", contextPath: "Patient.identifier[1]", isArrayElement: true, arrayIndex: 1 }
 * // ]
 */
export function getValidationTargets(
  resource: any,
  path: string
): ValidationTarget[] {
  if (!resource || typeof resource !== 'object') {
    return [];
  }

  const parts = path.split('.');

  // Skip resource type if present
  let startIndex = 0;
  if (parts[0] === resource.resourceType) {
    startIndex = 1;
  }

  // Start with a single target (the root resource)
  let targets: Array<{
    current: any;
    pathSoFar: string[];
    resourceTypePart: string;
  }> = [{
    current: resource,
    pathSoFar: [],
    resourceTypePart: parts[0] === resource.resourceType ? parts[0] : ''
  }];

  // Walk through each path segment
  for (let i = startIndex; i < parts.length; i++) {
    const segment = parts[i];
    const newTargets: typeof targets = [];

    for (const target of targets) {
      const currentValue = target.current;

      if (currentValue === undefined || currentValue === null) {
        // Dead end - this target can't continue
        continue;
      }

      let nextValue = currentValue[segment];

      // Handle FHIR choice types (e.g. value[x] -> valueQuantity, valueString)
      if (nextValue === undefined && segment.endsWith('[x]')) {
        const prefix = segment.slice(0, -3);
        const actualKey = Object.keys(currentValue).find(k => k.startsWith(prefix));
        if (actualKey) {
          nextValue = currentValue[actualKey];
          // We don't change the segment name in the pathSoFar to preserve the profile path
          // but we use the actual value found
        }
      }

      // Check if next value is an array - if so, fork into multiple targets
      if (Array.isArray(nextValue)) {
        // Fork: create one target for each array element
        for (let arrayIndex = 0; arrayIndex < nextValue.length; arrayIndex++) {
          newTargets.push({
            current: nextValue[arrayIndex],
            pathSoFar: [...target.pathSoFar, `${segment}[${arrayIndex}]`],
            resourceTypePart: target.resourceTypePart
          });
        }
      } else {
        // No array - continue with single target
        newTargets.push({
          current: nextValue,
          pathSoFar: [...target.pathSoFar, segment],
          resourceTypePart: target.resourceTypePart
        });
      }
    }

    targets = newTargets;
  }

  // Convert targets to ValidationTarget format
  return targets.map(convertToValidationTarget);
}

/** Converts a raw traversal target into a ValidationTarget with full path metadata. */
function convertToValidationTarget(target: {
  current: any;
  pathSoFar: string[];
  resourceTypePart: string;
}): ValidationTarget {
  const fullPath = target.resourceTypePart
    ? `${target.resourceTypePart}.${target.pathSoFar.join('.')}`
    : target.pathSoFar.join('.');

  // Context path is parent of the final element
  const contextPathParts = target.pathSoFar.slice(0, -1);
  const contextPath = target.resourceTypePart
    ? `${target.resourceTypePart}.${contextPathParts.join('.')}`
    : contextPathParts.join('.');

  // Check if this is an array element by looking for brackets in any segment
  const hasArraySegment = target.pathSoFar.some(seg => seg.includes('['));
  const isArrayElement = hasArraySegment;

  // Extract array index from the last array segment in the path
  let arrayIndex: number | undefined;
  for (let i = target.pathSoFar.length - 1; i >= 0; i--) {
    const match = target.pathSoFar[i].match(/\[(\d+)\]/);
    if (match) {
      arrayIndex = parseInt(match[1], 10);
      break;
    }
  }

  return {
    value: target.current,
    fullPath,
    contextPath: contextPath || target.resourceTypePart,
    isArrayElement,
    arrayIndex
  };
}

