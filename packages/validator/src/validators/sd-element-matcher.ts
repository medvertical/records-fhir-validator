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

import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types.js';
import { isConcreteChoiceProperty } from '../core/fhir-choice-property.js';
import { getPrimitiveSidecar } from '../core/fhir-primitive-sidecar.js';
import { PRIMITIVE_TYPE_CODES } from './type-matching-helpers.js';
import { logger } from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface MatchedElement {
    /** The SD element definition */
    element: ElementDefinition;
    /** The actual data from the resource */
    data: unknown;
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
    private elementMapCache = new WeakMap<ElementDefinition[], Map<string, ElementDefinition>>();

    /**
     * Match all resource data to SD elements
     */
    match(resource: unknown, structureDef: StructureDefinition): MatchResult {
        const matches: MatchedElement[] = [];
        const unmatchedPaths: string[] = [];

        if (!isObjectRecord(resource) ||
            (resource.resourceType !== undefined && typeof resource.resourceType !== 'string') ||
            !structureDef?.snapshot?.element) {
            return { matches, constraintElements: [], unmatchedPaths };
        }

        const resourceType = typeof resource.resourceType === 'string'
            ? resource.resourceType
            : structureDef.type;
        const elements = structureDef.snapshot.element;

        // Build element map for fast lookup
        const elementMap = this.getElementMap(elements);

        // Traverse resource and match to SD elements
        this.traverseAndMatch(
            resource,
            resourceType,
            elementMap,
            matches,
            unmatchedPaths,
            new WeakSet<object>(),
        );

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
    private getElementMap(elements: ElementDefinition[]): Map<string, ElementDefinition> {
        const cached = this.elementMapCache.get(elements);
        if (cached) return cached;

        const map = this.buildElementMap(elements);
        this.elementMapCache.set(elements, map);
        return map;
    }

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
        obj: unknown,
        currentPath: string,
        elementMap: Map<string, ElementDefinition>,
        matches: MatchedElement[],
        unmatchedPaths: string[],
        ancestors: WeakSet<object>,
    ): void {
        if (obj === undefined || obj === null) return;
        if (isObjectLike(obj) && ancestors.has(obj)) return;

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
        } else {
            unmatchedPaths.push(currentPath);
        }

        if (!isObjectLike(obj)) return;
        ancestors.add(obj);

        try {
            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    const item = obj[i];
                    if (item == null) continue;
                    const itemPath = `${currentPath}[${i}]`;

                    if (element) {
                        matches.push({
                            element,
                            data: item,
                            resourcePath: itemPath,
                            sdPath: element.path,
                            isArrayItem: true,
                            index: i
                        });
                    }

                    // Recurse into array items while treating the item itself as
                    // an ancestor, so a self-reference cannot re-enter it.
                    if (isObjectLike(item) && !ancestors.has(item)) {
                        ancestors.add(item);
                        for (const [key, value] of this.childEntries(item, itemPath, elementMap)) {
                            this.traverseAndMatch(
                                value,
                                `${itemPath}.${key}`,
                                elementMap,
                                matches,
                                unmatchedPaths,
                                ancestors,
                            );
                        }
                        ancestors.delete(item);
                    }
                }
            } else {
                // Recurse into object properties
                for (const [key, value] of this.childEntries(obj, currentPath, elementMap)) {
                    this.traverseAndMatch(
                        value,
                        `${currentPath}.${key}`,
                        elementMap,
                        matches,
                        unmatchedPaths,
                        ancestors,
                    );
                }
            }
        } finally {
            ancestors.delete(obj);
        }
    }

    private childEntries(
        container: Record<string, unknown> | unknown[],
        currentPath: string,
        elementMap: Map<string, ElementDefinition>,
    ): [string, unknown][] {
        if (Array.isArray(container)) return Object.keys(container).map(key => [key, getObjectValue(container, key)]);
        const children = new Map(Object.entries(container));
        children.delete('resourceType');
        for (const key of Object.keys(container)) {
            if (!key.startsWith('_')) continue;
            const logicalKey = key.slice(1);
            const element = this.findMatchingElement(`${currentPath}.${logicalKey}`, elementMap);
            if (!isDeclaredPrimitiveProperty(element, logicalKey)) continue;
            children.delete(key);
            children.set(logicalKey, resolvePrimitiveChild(container, logicalKey));
        }
        return [...children];
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

            const parentPrefix = `${parent}.`;
            for (const [candidatePath, candidateElement] of elementMap) {
                if (!candidatePath.startsWith(parentPrefix) || !candidatePath.endsWith('[x]')) {
                    continue;
                }
                const prefix = candidatePath.slice(parentPrefix.length, -3);
                if (isConcreteChoiceProperty(prop, prefix)) {
                    return candidateElement;
                }
            }
        }

        return undefined;
    }

    /**
     * Get all elements that need constraint evaluation
     */
    getConstraintTargets(resource: unknown, structureDef: StructureDefinition): MatchedElement[] {
        const result = this.match(resource, structureDef);
        return result.constraintElements;
    }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectLike(value: unknown): value is Record<string, unknown> | unknown[] {
    return typeof value === 'object' && value !== null;
}

function getObjectValue(
    value: Record<string, unknown> | unknown[],
    key: string,
): unknown {
    return Array.isArray(value) ? value[Number(key)] : value[key];
}

function isDeclaredPrimitiveProperty(element: ElementDefinition | undefined, property: string): boolean {
    return Boolean(element?.type?.some(type => PRIMITIVE_TYPE_CODES.has(type.code) &&
        (!element.path.endsWith('[x]') || property ===
            `${element.path.slice(element.path.lastIndexOf('.') + 1, -3)}${type.code[0].toUpperCase()}${type.code.slice(1)}`)));
}

function resolvePrimitiveChild(container: Record<string, unknown>, key: string): unknown {
    const direct = container[key];
    const sidecars = container[`_${key}`];
    if (direct != null && !Array.isArray(direct)) return direct;
    if (!Array.isArray(direct) && !Array.isArray(sidecars)) {
        return direct ?? getPrimitiveSidecar(container, key);
    }
    // FHIR primitive arrays align values and underscore metadata by index.
    // Missing placeholders must never shift a later element's constraint path.
    const values = Array.isArray(direct) ? direct : [];
    const metadata = Array.isArray(sidecars) ? sidecars : [];
    return Array.from({ length: Math.max(values.length, metadata.length) }, (_, index) =>
        values[index] ?? getPrimitiveSidecar({ [`_${key}`]: metadata[index] }, key));
}
