/**
 * Contained Resource Validator
 * 
 * Validates contained resources and their references:
 * - Contained resources must not have contained resources (dom-2)
 * - All internal references (#id) must resolve to contained resources
 * - Contained resources should be referenced at least once
 * - Contained resource IDs must be unique within the parent
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface ContainedValidationResult {
    issues: ValidationIssue[];
    containedMap: Map<string, any>;
    referencedIds: Set<string>;
    unreferencedIds: Set<string>;
}

// ============================================================================
// Contained Resource Validator
// ============================================================================

export class ContainedResourceValidator {

    /**
     * Validate contained resources in a resource
     */
    validate(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceType = resource?.resourceType || 'Unknown';

        if (!resource || !resource.contained || !Array.isArray(resource.contained)) {
            return issues;
        }

        logger.debug(`[ContainedValidator] Validating ${resource.contained.length} contained resources`);

        const containedMap = new Map<string, any>();
        const containedIds = new Set<string>();
        const referencedIds = new Set<string>();

        // 1. Build contained resource map and check for duplicates
        for (let i = 0; i < resource.contained.length; i++) {
            const contained = resource.contained[i];
            const path = `${resourceType}.contained[${i}]`;

            // Check if contained resource has an ID
            if (!contained.id) {
                issues.push(createValidationIssue({
                    code: 'contained-missing-id',
                    path,
                    resourceType,
                    customMessage: 'Contained resource must have an id',
                    severityOverride: 'error',
                }));
                continue;
            }

            // Check for duplicate IDs
            if (containedIds.has(contained.id)) {
                issues.push(createValidationIssue({
                    code: 'contained-duplicate-id',
                    path,
                    resourceType,
                    customMessage: `Duplicate contained resource id: '${contained.id}'`,
                    severityOverride: 'error',
                }));
            }

            containedIds.add(contained.id);
            containedMap.set(contained.id, contained);

            // 2. Check for nested contained resources (violates dom-2)
            if (contained.contained && Array.isArray(contained.contained) && contained.contained.length > 0) {
                issues.push(createValidationIssue({
                    code: 'contained-nested-violation',
                    path: `${path}.contained`,
                    resourceType,
                    customMessage: 'Contained resources cannot contain other resources (dom-2)',
                    severityOverride: 'error',
                }));
            }

            // Check contained resource has resourceType
            if (!contained.resourceType) {
                issues.push(createValidationIssue({
                    code: 'contained-missing-resourcetype',
                    path,
                    resourceType,
                    customMessage: 'Contained resource must have a resourceType',
                    severityOverride: 'error',
                }));
            }
        }

        // 3. Collect all internal references
        this.collectInternalReferences(resource, referencedIds, '');

        // 4. Check that all internal references resolve to contained resources
        for (const refId of referencedIds) {
            if (!containedIds.has(refId)) {
                issues.push(createValidationIssue({
                    code: 'contained-unresolved-reference',
                    path: resourceType,
                    resourceType,
                    customMessage: `Reference '#${refId}' does not resolve to a contained resource`,
                    severityOverride: 'error',
                }));
            }
        }

        // 5. Warn about unreferenced contained resources
        for (const id of containedIds) {
            if (!referencedIds.has(id)) {
                issues.push(createValidationIssue({
                    code: 'contained-unreferenced',
                    path: `${resourceType}.contained`,
                    resourceType,
                    customMessage: `Contained resource '${id}' is not referenced`,
                    severityOverride: 'warning',
                }));
            }
        }

        return issues;
    }

    /**
     * Collect all internal references (#id) from a resource
     */
    private collectInternalReferences(obj: any, refs: Set<string>, path: string): void {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.collectInternalReferences(obj[i], refs, `${path}[${i}]`);
            }
            return;
        }

        // Skip the contained array itself
        if (path.endsWith('.contained') || path === 'contained') {
            return;
        }

        for (const key of Object.keys(obj)) {
            const value = obj[key];
            const newPath = path ? `${path}.${key}` : key;

            // Check for reference field. A bare `#` is a self-reference to
            // the containing resource itself (valid FHIR, no contained lookup
            // needed), so we skip collecting it as an internal reference id.
            if (key === 'reference' && typeof value === 'string' && value.startsWith('#')) {
                const id = value.substring(1);
                if (id.length > 0) {
                    refs.add(id);
                }
            } else {
                this.collectInternalReferences(value, refs, newPath);
            }
        }
    }

    /**
     * Resolve an internal reference to its contained resource
     */
    resolveReference(resource: any, reference: string): any | null {
        if (!reference.startsWith('#')) {
            return null; // Not an internal reference
        }

        const id = reference.substring(1);
        if (!resource.contained || !Array.isArray(resource.contained)) {
            return null;
        }

        return resource.contained.find((c: any) => c.id === id) || null;
    }

    /**
     * Get validation result with additional metadata
     */
    validateWithMetadata(resource: any): ContainedValidationResult {
        const issues = this.validate(resource);
        const containedMap = new Map<string, any>();
        const referencedIds = new Set<string>();

        if (resource.contained && Array.isArray(resource.contained)) {
            for (const contained of resource.contained) {
                if (contained.id) {
                    containedMap.set(contained.id, contained);
                }
            }
            this.collectInternalReferences(resource, referencedIds, '');
        }

        const unreferencedIds = new Set<string>();
        for (const id of containedMap.keys()) {
            if (!referencedIds.has(id)) {
                unreferencedIds.add(id);
            }
        }

        return {
            issues,
            containedMap,
            referencedIds,
            unreferencedIds
        };
    }
}

// Singleton
export const containedResourceValidator = new ContainedResourceValidator();
