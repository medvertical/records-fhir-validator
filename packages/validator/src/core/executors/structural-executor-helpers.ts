/**
 * Structural Executor Helpers
 * 
 * Utility functions extracted from StructuralExecutor for reusability
 * and to keep the main executor file under 500 lines.
 */

import type { ElementDefinition } from '../structure-definition-types';

// ============================================================================
// Primitive Type Checking
// ============================================================================

/**
 * Set of all FHIR primitive types
 */
const PRIMITIVE_TYPES = new Set([
    'boolean', 'integer', 'string', 'decimal', 'uri', 'url', 'canonical',
    'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code',
    'oid', 'id', 'markdown', 'unsignedInt', 'positiveInt'
]);

/**
 * Check if a type code represents a primitive type
 */
export function isPrimitiveType(typeCode: string): boolean {
    return PRIMITIVE_TYPES.has(typeCode);
}

// ============================================================================
// Value Access Utilities
// ============================================================================

/**
 * Get direct value from resource using simple path (for fallback checking)
 */
export function getDirectValue(resource: any, path: string): any {
    const parts = path.split('.');

    // Remove resource type prefix
    if (parts[0] === resource?.resourceType) {
        parts.shift();
    }

    let current: any = resource;
    for (const part of parts) {
        if (current === undefined || current === null) {
            return undefined;
        }
        let value = current[part];
        // Handle FHIR choice types (e.g. value[x] → valueCoding, valueString)
        if (value === undefined && part.endsWith('[x]') && typeof current === 'object') {
            const prefix = part.slice(0, -3);
            const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
            if (actualKey) value = current[actualKey];
        }
        current = value;
        if (current === undefined) {
            return undefined;
        }
    }

    return current;
}

/**
 * Get nested value from object using dot notation
 * Handles simple property access (e.g., "system" from { system: "..." })
 */
export function getNestedValue(obj: any, path: string): any {
    if (!path || path === '.') {
        return obj;
    }

    // If path is empty after filtering, return the object
    const parts = path.split('.').filter(p => p.length > 0);
    if (parts.length === 0) {
        return obj;
    }

    let current = obj;

    for (const part of parts) {
        // If current is null/undefined, we can't continue
        if (current === null || current === undefined) {
            return undefined;
        }

        // If current is not an object (and not an array), we can't access properties
        // But allow arrays to be accessed by index if part is a number
        if (typeof current !== 'object') {
            return undefined;
        }

        // Handle array access if part is a numeric index
        if (Array.isArray(current)) {
            const index = parseInt(part, 10);
            if (!isNaN(index) && index >= 0 && index < current.length) {
                current = current[index];
            } else {
                // Not a valid array index, try as property name
                // This handles cases where we might have an array but are looking for a property
                return undefined;
            }
        } else {
            // Regular object property access
            let value = current[part];
            // Handle FHIR choice types (e.g. value[x] → valueCoding, valueString)
            if (value === undefined && part.endsWith('[x]') && typeof current === 'object') {
                const prefix = part.slice(0, -3);
                const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
                if (actualKey) value = current[actualKey];
            }
            current = value;
        }

        // If we got undefined at any step, return undefined
        if (current === undefined) {
            return undefined;
        }
    }

    return current;
}

// ============================================================================
// Value Checking Utilities
// ============================================================================

/**
 * Check if a value is empty (missing or has no meaningful content)
 */
export function isValueEmpty(value: any): boolean {
    // Undefined or null is empty
    if (value === undefined || value === null) {
        return true;
    }

    // Empty array is empty
    if (Array.isArray(value)) {
        return value.length === 0;
    }

    // Empty object is empty (but objects with keys are not empty)
    if (typeof value === 'object') {
        // Check if it's a plain object (not Date, etc.)
        if (value.constructor === Object) {
            return Object.keys(value).length === 0;
        }
        // Non-plain objects (Date, etc.) are not empty if they exist
        return false;
    }

    // Primitives (string, number, boolean) are not empty if they exist
    // Empty string is considered empty
    if (typeof value === 'string') {
        return value.trim().length === 0;
    }

    // Numbers and booleans are never empty if they exist
    return false;
}

// ============================================================================
// Element Definition Utilities
// ============================================================================

/**
 * Merge profile-specific element constraints into base element definition
 * Profile constraints override base constraints (e.g., stricter cardinality)
 */
export function mergeElementConstraints(
    baseElement: ElementDefinition,
    profileElement: ElementDefinition
): ElementDefinition {
    const merged = { ...baseElement };

    // Profile can tighten cardinality (increase min, decrease max)
    if (profileElement.min !== undefined) {
        merged.min = Math.max(baseElement.min || 0, profileElement.min);
    }

    if (profileElement.max !== undefined) {
        // Restrict max cardinality
        const baseMax = baseElement.max === '*' ? 999999 : parseInt(baseElement.max || '1', 10);
        const profileMax = profileElement.max === '*' ? 999999 : parseInt(profileElement.max, 10);
        merged.max = Math.min(baseMax, profileMax).toString();
        if (merged.max === '999999') merged.max = '*';
    }

    // Profile can restrict types
    if (profileElement.type && profileElement.type.length > 0) {
        merged.type = profileElement.type;
    }

    // Profile can add constraints
    if (profileElement.constraint) {
        merged.constraint = [
            ...(baseElement.constraint || []),
            ...profileElement.constraint
        ];
    }

    // Profile can add mustSupport
    if (profileElement.mustSupport !== undefined) {
        merged.mustSupport = profileElement.mustSupport;
    }

    return merged;
}
