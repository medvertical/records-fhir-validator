import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/index.js';
import {
    isValueEmpty,
    getDirectValue
} from '../core/executors/structural-executor-helpers.js';
import { shouldSkipMustSupportForResource } from './must-support-applicability.js';

/**
 * Validator for MustSupport elements
 * Handles validation of elements marked with mustSupport=true
 */
export class MustSupportValidator {
    private mustSupportSeverity: 'error' | 'warning' | 'information' = 'warning';

    /**
     * Configure mustSupport validation severity
     */
    setMustSupportSeverity(severity: 'error' | 'warning' | 'information'): void {
        this.mustSupportSeverity = severity;
    }

    /**
     * Validate a single mustSupport element
     */
    validateMustSupportElement(
        path: string,
        profileUrl: string,
        resource?: unknown,
        elementDef: { sliceName?: string } = {}
    ): ValidationIssue[] {
        if (resource !== undefined && this.shouldSkipMustSupportElement(resource, path, elementDef)) {
            return [];
        }
        const resourceType = getResourceType(resource);

        return [createValidationIssue({
            code: 'profile-mustsupport-missing',
            path,
            resourceType,
            profile: profileUrl,
            messageParams: { element: path },
            severityOverride: this.mustSupportSeverity === 'information'
                ? 'info'
                : this.mustSupportSeverity,
        })];
    }

    /**
     * Check if a mustSupport element should be skipped (false positive filters).
     */
    private shouldSkipMustSupportElement(
        resource: unknown, path: string, elementDef: { sliceName?: string }
    ): boolean {
        if (!isRecord(resource)) return false;

        // Skip generic extension paths without slice discriminator
        if (path.endsWith('.extension') && !elementDef.sliceName) return true;

        // Skip primitive element extensions (_elementName.extension)
        const pathParts = path.split('.');
        const lastPart = pathParts[pathParts.length - 1];
        const secondToLast = pathParts[pathParts.length - 2];
        if (lastPart === 'extension' && secondToLast?.startsWith('_')) return true;

        if (!mustSupportParentExists(resource, path)) return true;
        return shouldSkipMustSupportForResource(resource, path);
    }

    /**
     * Check if a mustSupport element exists using multiple resolution strategies.
     */
    private checkElementExists<TResource>(
        resource: TResource, path: string,
        getValueAtPath: (resource: TResource, path: string) => unknown
    ): boolean {
        // Method 1: Array-aware validation targets
        const targets = getValidationTargets(resource, path);
        if (targets.some(t => !isValueEmpty(t.value))) return true;

        // Method 2: Direct property access
        if (!isValueEmpty(getDirectValue(resource, path))) return true;

        // Method 3: getValueAtPath (most reliable)
        try {
            if (!isValueEmpty(getValueAtPath(resource, path))) return true;
        } catch { /* invalid paths may throw */ }

        return false;
    }

    /**
     * Validate all mustSupport elements in the profile snapshot
     * This ensures comprehensive mustSupport checking even for elements that might be missed in the main loop
     * Uses array-aware validation like required fields validation
     */
    async validateAllMustSupportElements<TResource>(
        resource: TResource,
        structureDef: StructureDefinition,
        profileUrl: string,
        getValueAtPath: (resource: TResource, path: string) => unknown,
        alreadyCheckedPaths: Set<string> = new Set()
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];
        const resourceType = getResourceType(resource);

        if (!structureDef.snapshot?.element) {
            return issues;
        }

        for (const elementDef of structureDef.snapshot.element) {
            if (elementDef.mustSupport !== true) continue;

            const path = elementDef.path;

            // Skip root element
            if (path === resourceType) continue;

            // Skip SD definition children — these are element definitions, not data
            if (resourceType === 'StructureDefinition' &&
                (path.startsWith('StructureDefinition.snapshot.element.') ||
                 path.startsWith('StructureDefinition.differential.element.'))) {
                continue;
            }

            if (alreadyCheckedPaths.has(path)) continue;
            if (this.shouldSkipMustSupportElement(resource, path, elementDef)) continue;

            // Avoid cascading false positives for deep child paths when the
            // repeatable/complex parent is absent. Report the parent itself,
            // but let skeleton/profile handlers expose its children on demand.
            const parentPath = path.split('.').slice(0, -1).join('.');
            if (
                parentPath &&
                parentPath !== resourceType &&
                !this.checkElementExists(resource, parentPath, getValueAtPath)
            ) {
                continue;
            }

            if (!this.checkElementExists(resource, path, getValueAtPath)) {
                issues.push(createValidationIssue({
                    code: 'profile-mustsupport-missing',
                    path,
                    resourceType,
                    profile: profileUrl,
                    messageParams: { element: path },
                    severityOverride: this.mustSupportSeverity === 'information'
                        ? 'info'
                        : this.mustSupportSeverity,
                }));
            }
        }

        return issues;
    }
}

function mustSupportParentExists(resource: unknown, path: string): boolean {
    const parentPath = path.split('.').slice(0, -1).join('.');
    if (!parentPath || parentPath === getResourceType(resource)) return true;

    const targets = getValidationTargets(resource, parentPath);
    if (targets.some(target => !isValueEmpty(target.value))) return true;

    return !isValueEmpty(getDirectValue(resource, parentPath));
}

function getResourceType(resource: unknown): string {
    return isRecord(resource) && typeof resource.resourceType === 'string'
        ? resource.resourceType
        : 'Unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
