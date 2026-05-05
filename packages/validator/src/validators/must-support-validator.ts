import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { StructureDefinition } from '../core/structure-definition-types';
import { getValidationTargets } from '../business-rules';
import {
    isValueEmpty,
    getDirectValue
} from '../core/executors/structural-executor-helpers';

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
        profileUrl: string
    ): ValidationIssue[] {
        return [createValidationIssue({
            code: 'profile-mustsupport-missing',
            path,
            resourceType: 'Unknown',
            profile: profileUrl,
            messageParams: { element: path },
        })];
    }

    /**
     * Check if a mustSupport element should be skipped (false positive filters).
     */
    private shouldSkipMustSupportElement(
        resource: any, path: string, elementDef: { sliceName?: string }
    ): boolean {
        // Skip generic extension paths without slice discriminator
        if (path.endsWith('.extension') && !elementDef.sliceName) return true;

        // Skip primitive element extensions (_elementName.extension)
        const pathParts = path.split('.');
        const lastPart = pathParts[pathParts.length - 1];
        const secondToLast = pathParts[pathParts.length - 2];
        if (lastPart === 'extension' && secondToLast?.startsWith('_')) return true;

        // For Observation.value[x], dataAbsentReason satisfies the requirement
        if (path === 'Observation.value[x]' || path.match(/^Observation\.value\[x\]$/i)) {
            if (resource.dataAbsentReason && !isValueEmpty(resource.dataAbsentReason)) return true;
        }

        // For Observation.component.value[x], check component dataAbsentReason
        if (path.match(/^Observation\.component\.value\[x\]$/i)) {
            const components = resource.component;
            if (Array.isArray(components) && components.length > 0) {
                if (components.every((c: any) => c.dataAbsentReason && !isValueEmpty(c.dataAbsentReason))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if a mustSupport element exists using multiple resolution strategies.
     */
    private checkElementExists(
        resource: any, path: string,
        getValueAtPath: (resource: any, path: string) => any
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
    async validateAllMustSupportElements(
        resource: any,
        structureDef: StructureDefinition,
        profileUrl: string,
        getValueAtPath: (resource: any, path: string) => any,
        alreadyCheckedPaths: Set<string> = new Set()
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!structureDef.snapshot?.element) {
            return issues;
        }

        for (const elementDef of structureDef.snapshot.element) {
            if (elementDef.mustSupport !== true) continue;

            const path = elementDef.path;

            // Skip root element
            if (path === resource.resourceType) continue;

            // Skip SD definition children — these are element definitions, not data
            if (resource.resourceType === 'StructureDefinition' &&
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
                parentPath !== resource.resourceType &&
                !this.checkElementExists(resource, parentPath, getValueAtPath)
            ) {
                continue;
            }

            if (!this.checkElementExists(resource, path, getValueAtPath)) {
                issues.push(createValidationIssue({
                    code: 'profile-mustsupport-missing',
                    path,
                    resourceType: resource.resourceType,
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
