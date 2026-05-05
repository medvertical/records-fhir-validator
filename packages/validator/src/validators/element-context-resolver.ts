/**
 * Element Context Resolver
 * 
 * Resolves the correct FHIRPath evaluation context for each element path
 * in a StructureDefinition. This is critical for HAPI parity because
 * constraints must be evaluated in the context of their specific element,
 * not just the root resource.
 * 
 * Key Features:
 * - Resolves nested paths (Patient.contact.name)
 * - Handles arrays with proper indexing
 * - Supports choice types (value[x])
 * - Returns all matching contexts for array elements
 */

import { logger as _logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface ElementContext {
    /** The element value(s) to evaluate constraints on */
    value: any;
    /** Full path including indices */
    fullPath: string;
    /** Whether this is an array element */
    isArray: boolean;
    /** Index if array element */
    index?: number;
}

// ============================================================================
// Element Context Resolver
// ============================================================================

export class ElementContextResolver {

    /**
     * Resolve all contexts for an element path
     * Returns multiple contexts for array elements
     */
    resolveContexts(resource: any, elementPath: string, resourceType: string): ElementContext[] {
        const contexts: ElementContext[] = [];

        // Remove resource type prefix
        let relativePath = elementPath;
        if (elementPath.startsWith(resourceType + '.')) {
            relativePath = elementPath.substring(resourceType.length + 1);
        }

        // Root element
        if (!relativePath || elementPath === resourceType) {
            return [{
                value: resource,
                fullPath: resourceType,
                isArray: false
            }];
        }

        // Traverse the path
        this.traversePath(resource, relativePath, resourceType, contexts);

        return contexts;
    }

    /**
     * Recursively traverse path and collect all matching contexts
     */
    private traversePath(
        current: any,
        remainingPath: string,
        currentFullPath: string,
        contexts: ElementContext[]
    ): void {
        if (current === undefined || current === null) {
            return;
        }

        // Split into segments
        const dotIndex = remainingPath.indexOf('.');
        const segment = dotIndex >= 0 ? remainingPath.substring(0, dotIndex) : remainingPath;
        const restPath = dotIndex >= 0 ? remainingPath.substring(dotIndex + 1) : '';

        // Handle choice types (value[x])
        let actualSegment = segment;
        let value: any;

        if (segment.endsWith('[x]')) {
            const baseName = segment.slice(0, -3);
            // Find matching property
            for (const key of Object.keys(current)) {
                if (key.startsWith(baseName) && key !== baseName) {
                    actualSegment = key;
                    value = current[key];
                    break;
                }
            }
            if (value === undefined) {
                return; // Choice type not present
            }
        } else {
            value = current[segment];
            if (value === undefined) {
                return; // Element not present
            }
        }

        const newFullPath = `${currentFullPath}.${actualSegment}`;

        // If no more path segments, we've reached the target
        if (!restPath) {
            if (Array.isArray(value)) {
                // Add context for each array element
                for (let i = 0; i < value.length; i++) {
                    contexts.push({
                        value: value[i],
                        fullPath: `${newFullPath}[${i}]`,
                        isArray: true,
                        index: i
                    });
                }
            } else {
                contexts.push({
                    value,
                    fullPath: newFullPath,
                    isArray: false
                });
            }
            return;
        }

        // Continue traversing
        if (Array.isArray(value)) {
            // Traverse each array element
            for (let i = 0; i < value.length; i++) {
                this.traversePath(
                    value[i],
                    restPath,
                    `${newFullPath}[${i}]`,
                    contexts
                );
            }
        } else {
            this.traversePath(value, restPath, newFullPath, contexts);
        }
    }

    /**
     * Check if an element exists at the given path
     */
    elementExists(resource: any, elementPath: string, resourceType: string): boolean {
        const contexts = this.resolveContexts(resource, elementPath, resourceType);
        return contexts.length > 0;
    }

    /**
     * Get all values at a path (flattened)
     */
    getValuesAtPath(resource: any, elementPath: string, resourceType: string): any[] {
        const contexts = this.resolveContexts(resource, elementPath, resourceType);
        return contexts.map(c => c.value);
    }
}

// Singleton
export const elementContextResolver = new ElementContextResolver();
