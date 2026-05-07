/**
 * SD Constraint Collector
 * 
 * Extracts ALL constraints from a StructureDefinition to ensure complete
 * coverage. Unlike the regular constraint validator which may skip elements,
 * this collector guarantees every constraint is found and can be evaluated.
 * 
 * This is key for HAPI parity - HAPI evaluates every single constraint
 * regardless of whether the target element exists.
 */

import type { StructureDefinition, Constraint } from '../core/structure-definition-types';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface CollectedConstraint {
    /** Full path to the element (e.g., "Patient.contact") */
    elementPath: string;
    /** The constraint from the SD */
    constraint: Constraint;
    /** Whether this is on the root element */
    isRootConstraint: boolean;
    /** Element cardinality - 0 means optional */
    minCardinality: number;
    /** Type(s) of the element */
    elementTypes: string[];
    /**
     * Slice name when the source element is part of a slice
     * (e.g. `Organization.identifier:NPI` → `'NPI'`). Constraints on
     * slice elements only apply to instances matching the slice
     * discriminator — the generic executor does not have slice-aware
     * context resolution and would fire the constraint on every value
     * at the path, so the executor uses this field to skip them.
     */
    sliceName?: string;
}

export interface ConstraintCollectionResult {
    /** All constraints from the SD */
    constraints: CollectedConstraint[];
    /** Constraints grouped by key (e.g., 'dom-2', 'obs-6') */
    byKey: Map<string, CollectedConstraint[]>;
    /** Root-level constraints (apply to entire resource) */
    rootConstraints: CollectedConstraint[];
    /** Element-level constraints */
    elementConstraints: CollectedConstraint[];
    /** Stats */
    totalCount: number;
    uniqueKeys: string[];
}

// ============================================================================
// SD Constraint Collector
// ============================================================================

export class SDConstraintCollector {

    /**
     * Collect ALL constraints from a StructureDefinition
     */
    collect(structureDef: StructureDefinition): ConstraintCollectionResult {
        const constraints: CollectedConstraint[] = [];
        const byKey = new Map<string, CollectedConstraint[]>();

        if (!structureDef?.snapshot?.element) {
            return this.buildResult(constraints, byKey);
        }

        const resourceType = structureDef.snapshot.element[0]?.path || '';

        logger.debug(`[SDConstraintCollector] Collecting constraints from ${structureDef.url || resourceType}`);

        // Iterate through ALL elements
        for (const element of structureDef.snapshot.element) {
            if (!element.constraint || element.constraint.length === 0) {
                continue;
            }

            const isRootConstraint = element.path === resourceType;
            const elementTypes = element.type?.map(t => t.code) || [];

            for (const constraint of element.constraint) {
                // Skip constraints without expressions (they can't be evaluated)
                if (!constraint.expression) {
                    continue;
                }

                const collected: CollectedConstraint = {
                    elementPath: element.path,
                    constraint,
                    isRootConstraint,
                    minCardinality: element.min || 0,
                    elementTypes,
                    ...(element.sliceName ? { sliceName: element.sliceName } : {}),
                };

                constraints.push(collected);

                // Index by key
                const key = constraint.key;
                if (!byKey.has(key)) {
                    byKey.set(key, []);
                }
                byKey.get(key)!.push(collected);
            }
        }

        const result = this.buildResult(constraints, byKey);

        logger.debug(`[SDConstraintCollector] Collected ${result.totalCount} constraints with ${result.uniqueKeys.length} unique keys`);
        logger.debug(`[SDConstraintCollector] Keys: ${result.uniqueKeys.slice(0, 10).join(', ')}${result.uniqueKeys.length > 10 ? '...' : ''}`);

        return result;
    }

    /**
     * Collect constraints for a specific resource type
     */
    collectForResource(structureDef: StructureDefinition, _resource: any): CollectedConstraint[] {
        const result = this.collect(structureDef);

        // For now, return all constraints - the validator will decide which to evaluate
        // based on whether the element exists in the resource
        return result.constraints;
    }

    /**
     * Get constraints that MUST be evaluated (root + present elements)
     */
    getMandatoryConstraints(structureDef: StructureDefinition, resource: any): CollectedConstraint[] {
        const allConstraints = this.collectForResource(structureDef, resource);
        const mandatory: CollectedConstraint[] = [];
        const resourceType = resource.resourceType;

        for (const collected of allConstraints) {
            // Root constraints are always mandatory
            if (collected.isRootConstraint) {
                mandatory.push(collected);
                continue;
            }

            // Check if element exists in resource
            const relativePath = collected.elementPath.replace(`${resourceType}.`, '');
            if (this.pathExistsInResource(resource, relativePath)) {
                mandatory.push(collected);
            }
        }

        return mandatory;
    }

    /**
     * Check if a path exists in a resource
     */
    private pathExistsInResource(resource: any, path: string): boolean {
        const segments = path.split('.');
        let current = resource;

        for (const segment of segments) {
            if (current === undefined || current === null) {
                return false;
            }

            // Handle choice types
            if (segment.endsWith('[x]')) {
                const baseName = segment.slice(0, -3);
                const found = Object.keys(current).some(k => k.startsWith(baseName) && k !== baseName);
                if (found) {
                    // Find the actual key
                    for (const key of Object.keys(current)) {
                        if (key.startsWith(baseName) && key !== baseName) {
                            current = current[key];
                            break;
                        }
                    }
                } else {
                    return false;
                }
            } else if (Array.isArray(current)) {
                // Array - check if any element has the property
                return current.some(item => item && item[segment] !== undefined);
            } else {
                current = current[segment];
            }
        }

        return current !== undefined;
    }

    /**
     * Build the result object
     */
    private buildResult(
        constraints: CollectedConstraint[],
        byKey: Map<string, CollectedConstraint[]>
    ): ConstraintCollectionResult {
        const rootConstraints = constraints.filter(c => c.isRootConstraint);
        const elementConstraints = constraints.filter(c => !c.isRootConstraint);
        const uniqueKeys = Array.from(byKey.keys()).sort();

        return {
            constraints,
            byKey,
            rootConstraints,
            elementConstraints,
            totalCount: constraints.length,
            uniqueKeys
        };
    }
}

// Singleton
export const sdConstraintCollector = new SDConstraintCollector();
