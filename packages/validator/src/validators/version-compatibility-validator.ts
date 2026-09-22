/**
 * FHIR Version Compatibility Validator
 * 
 * Validates resources for R5/R6 compatibility:
 * - Deprecated element detection with migration hints
 * - Breaking changes between FHIR versions
 * - FHIR version detection from resource structure
 * 
 * Helps developers migrate resources between FHIR versions.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import {
    DEPRECATED_ELEMENTS,
    RENAMED_ELEMENTS,
    type DeprecatedElement,
    type FHIRVersion,
    type VersionCompatibilityConfig,
} from './version-compatibility-rules.js';

export type {
    DeprecatedElement,
    FHIRVersion,
    RenamedElement,
    VersionCompatibilityConfig,
} from './version-compatibility-rules.js';

export class VersionCompatibilityValidator {
    private config: VersionCompatibilityConfig;

    constructor(config?: Partial<VersionCompatibilityConfig>) {
        this.config = {
            targetVersion: 'R5',
            reportDeprecated: true,
            reportRenamed: true,
            ...config
        };
    }

    /**
     * Set target FHIR version
     */
    setTargetVersion(version: FHIRVersion): void {
        this.config.targetVersion = version;
    }

    /**
     * Validate resource for version compatibility
     */
    validate(resource: unknown): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        if (!isRecord(resource) || typeof resource.resourceType !== 'string') {
            return issues;
        }
        const resourceType = resource.resourceType;

        logger.debug(`[VersionValidator] Checking ${resourceType} for ${this.config.targetVersion} compatibility`);

        // Check deprecated elements
        if (this.config.reportDeprecated) {
            issues.push(...this.checkDeprecatedElements(resource, resourceType));
        }

        // Check renamed elements
        if (this.config.reportRenamed) {
            issues.push(...this.checkRenamedElements(resource, resourceType));
        }

        return issues;
    }

    /**
     * Check for deprecated elements in resource
     */
    private checkDeprecatedElements(
        resource: Record<string, unknown>,
        resourceType: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const relevantDeprecated = DEPRECATED_ELEMENTS.filter(
            d => d.resourceType === resourceType && this.isDeprecatedForVersion(d)
        );

        for (const dep of relevantDeprecated) {
            const pathParts = dep.path.split('.').slice(1); // Remove resourceType prefix
            const value = this.getValueAtPath(resource, pathParts);

            if (value !== undefined) {
                let message = `Element '${dep.path}' is deprecated in FHIR ${dep.deprecatedIn}`;
                if (dep.replacement) {
                    message += `. Use '${dep.replacement}' instead.`;
                }

                issues.push(createValidationIssue({
                    code: 'version-deprecated-element',
                    path: dep.path,
                    resourceType,
                    customMessage: message,
                    severityOverride: 'warning',
                    details: { migrationHint: dep.migrationHint }
                }));
            }
        }

        return issues;
    }

    /**
     * Check for elements that need renaming
     */
    private checkRenamedElements(
        resource: Record<string, unknown>,
        resourceType: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const relevantRenamed = RENAMED_ELEMENTS.filter(
            r => r.resourceType === resourceType &&
                this.versionCompare(this.config.targetVersion, r.changedIn) >= 0
        );

        for (const renamed of relevantRenamed) {
            const value = this.getValueAtPath(resource, [renamed.oldPath]);

            if (value !== undefined) {
                issues.push(createValidationIssue({
                    code: 'version-renamed-element',
                    path: `${resourceType}.${renamed.oldPath}`,
                    resourceType,
                    customMessage: `Element '${renamed.oldPath}' was renamed to '${renamed.newPath}' in FHIR ${renamed.changedIn}`,
                    severityOverride: 'info',
                }));
            }
        }

        return issues;
    }

    /**
     * Check if element is deprecated for current target version
     */
    private isDeprecatedForVersion(dep: DeprecatedElement): boolean {
        return this.versionCompare(this.config.targetVersion, dep.deprecatedIn) >= 0;
    }

    /**
     * Compare FHIR versions (returns -1, 0, or 1)
     */
    private versionCompare(a: FHIRVersion, b: FHIRVersion): number {
        const order: Record<FHIRVersion, number> = { 'R4': 1, 'R4B': 2, 'R5': 3, 'R6': 4 };
        return order[a] - order[b];
    }

    /**
     * Get value at path in object
     */
    private getValueAtPath(obj: unknown, pathParts: string[]): unknown {
        let current: unknown = obj;
        for (const part of pathParts) {
            if (!isRecord(current)) return undefined;
            current = current[part];
        }
        return current;
    }

    /**
     * Detect FHIR version from resource structure
     */
    detectVersion(resource: unknown): { detected: FHIRVersion; confidence: 'high' | 'medium' | 'low'; hints: string[] } {
        const hints: string[] = [];
        let detected: FHIRVersion = 'R4';
        let confidence: 'high' | 'medium' | 'low' = 'low';
        if (!isRecord(resource)) return { detected, confidence, hints };

        // Check fhirVersion in meta (most reliable)
        const meta = isRecord(resource.meta) ? resource.meta : undefined;
        if (Array.isArray(meta?.profile)) {
            for (const profile of meta.profile) {
                if (typeof profile !== 'string') continue;
                if (profile.includes('/5.0/') || profile.includes('|5.0')) {
                    hints.push('Profile URL indicates R5');
                    if (this.versionCompare(detected, 'R5') < 0) detected = 'R5';
                    confidence = 'high';
                } else if (profile.includes('/6.0/') || profile.includes('|6.0')) {
                    hints.push('Profile URL indicates R6');
                    if (this.versionCompare(detected, 'R6') < 0) detected = 'R6';
                    confidence = 'high';
                }
            }
        }

        // Check for R5-specific structures
        const resourceType = resource.resourceType;
        if (resourceType === 'Encounter' && resource.admission && !resource.hospitalization) {
            hints.push('Encounter.admission present (R5+)');
            if (detected === 'R4') detected = 'R5';
            if (confidence === 'low') confidence = 'medium';
        }

        const medication = isRecord(resource.medication) ? resource.medication : undefined;
        if (resourceType === 'MedicationRequest' && medication?.concept) {
            hints.push('MedicationRequest.medication uses CodeableReference (R5+)');
            if (detected === 'R4') detected = 'R5';
            if (confidence === 'low') confidence = 'medium';
        }

        return { detected, confidence, hints };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
