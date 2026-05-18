/**
 * SD Element Matcher
 * 
 * Matches resource data to StructureDefinition elements.
 * Critical for deep SD traversal - ensures constraints are
 * evaluated on the correct elements even for complex types.
 * 
 * Key Features:
 * - Match resource paths to SD element definitions
 * - Handle polymorphic types (value[x])
 * - Support slicing discriminators
 * - Resolve element inheritance
 */

import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface MatchedElement {
    /** The SD element definition */
    element: ElementDefinition;
    /** The actual data from the resource */
    data: any;
    /** Full path in the resource (with indices) */
    resourcePath: string;
    /** Path in the SD */
    sdPath: string;
    /** Whether this is an array item */
    isArrayItem: boolean;
    /** Index if array item */
    index?: number;
}

export interface MatchResult {
    /** All matched elements */
    matches: MatchedElement[];
    /** Elements with constraints */
    constraintElements: MatchedElement[];
    /** Unmatched paths in resource (potential unknown elements) */
    unmatchedPaths: string[];
}

// ============================================================================
// SD Element Matcher
// ============================================================================

export class SDElementMatcher {

    /**
     * Match all resource data to SD elements
     */
    match(resource: any, structureDef: StructureDefinition): MatchResult {
        const matches: MatchedElement[] = [];
        const unmatchedPaths: string[] = [];

        if (!resource || !structureDef?.snapshot?.element) {
            return { matches, constraintElements: [], unmatchedPaths };
        }

        const resourceType = resource.resourceType;
        const elements = structureDef.snapshot.element;

        // Build element map for fast lookup
        const elementMap = this.buildElementMap(elements);

        // Traverse resource and match to SD elements
        this.traverseAndMatch(resource, resourceType, elementMap, matches, unmatchedPaths);

        // Filter to elements with constraints
        const constraintElements = matches.filter(m =>
            m.element.constraint && m.element.constraint.length > 0 && !Array.isArray(m.data)
        );

        logger.debug(`[SDElementMatcher] Matched ${matches.length} elements, ${constraintElements.length} with constraints`);

        return { matches, constraintElements, unmatchedPaths };
    }

    /**
     * Build a map of SD elements by path
     */
    private buildElementMap(elements: ElementDefinition[]): Map<string, ElementDefinition> {
        const map = new Map<string, ElementDefinition>();

        for (const element of elements) {
            if (typeof element.id === 'string' && element.id.includes(':')) {
                continue;
            }

            map.set(element.path, element);

            // Also add without choice type suffix for matching
            if (element.path.includes('[x]')) {
                const basePath = element.path.replace('[x]', '');
                if (!map.has(basePath)) {
                    map.set(basePath, element);
                }
            }
        }

        return map;
    }

    /**
     * Recursively traverse resource and match to SD elements
     */
    private traverseAndMatch(
        obj: any,
        currentPath: string,
        elementMap: Map<string, ElementDefinition>,
        matches: MatchedElement[],
        unmatchedPaths: string[]
    ): void {
        if (obj === undefined || obj === null) return;

        // Try to find matching SD element
        const element = this.findMatchingElement(currentPath, elementMap);

        if (element) {
            matches.push({
                element,
                data: obj,
                resourcePath: currentPath,
                sdPath: element.path,
                isArrayItem: false
            });
        }

        if (typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                const itemPath = `${currentPath}[${i}]`;

                if (element) {
                    matches.push({
                        element,
                        data: obj[i],
                        resourcePath: itemPath,
                        sdPath: element.path,
                        isArrayItem: true,
                        index: i
                    });
                }

                // Recurse into array items
                if (typeof obj[i] === 'object' && obj[i] !== null) {
                    for (const key of Object.keys(obj[i])) {
                        this.traverseAndMatch(obj[i][key], `${itemPath}.${key}`, elementMap, matches, unmatchedPaths);
                    }
                }
            }
        } else {
            // Recurse into object properties
            for (const key of Object.keys(obj)) {
                if (key === 'resourceType') continue;
                this.traverseAndMatch(obj[key], `${currentPath}.${key}`, elementMap, matches, unmatchedPaths);
            }
        }
    }

    /**
     * Find matching SD element for a resource path
     */
    private findMatchingElement(resourcePath: string, elementMap: Map<string, ElementDefinition>): ElementDefinition | undefined {
        // Remove array indices for SD matching
        const normalizedPath = resourcePath.replace(/\[\d+\]/g, '');

        // Direct match
        if (elementMap.has(normalizedPath)) {
            return elementMap.get(normalizedPath);
        }

        // Try polymorphic match (e.g., valueQuantity -> value[x])
        const lastDot = normalizedPath.lastIndexOf('.');
        if (lastDot > 0) {
            const parent = normalizedPath.substring(0, lastDot);
            const prop = normalizedPath.substring(lastDot + 1);

            // Check polymorphic prefixes — must match CHOICE_BASES in constraint-validator.ts
            const prefixes = [
                'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
                'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
                'product', 'serviced', 'location', 'allowed', 'used',
                'rate', 'born', 'age',
            ];
            for (const prefix of prefixes) {
                if (prop.startsWith(prefix) && prop !== prefix) {
                    const polyPath = `${parent}.${prefix}[x]`;
                    if (elementMap.has(polyPath)) {
                        return elementMap.get(polyPath);
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Get all elements that need constraint evaluation
     */
    getConstraintTargets(resource: any, structureDef: StructureDefinition): MatchedElement[] {
        const result = this.match(resource, structureDef);
        return result.constraintElements;
    }
}

// Singleton
export const sdElementMatcher = new SDElementMatcher();
