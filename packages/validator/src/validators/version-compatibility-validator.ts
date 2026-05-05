/**
 * FHIR Version Compatibility Validator
 * 
 * Validates resources for R5/R6 compatibility:
 * - Deprecated element detection with migration hints
 * - New R5/R6 element requirements
 * - Breaking changes between FHIR versions
 * - FHIR version detection from resource structure
 * 
 * Helps developers migrate resources between FHIR versions.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export type FHIRVersion = 'R4' | 'R4B' | 'R5' | 'R6';

export interface VersionCompatibilityConfig {
    /** Target FHIR version to validate against */
    targetVersion: FHIRVersion;
    /** Report deprecated elements */
    reportDeprecated: boolean;
    /** Report new required elements */
    reportNewRequired: boolean;
    /** Report renamed elements */
    reportRenamed: boolean;
}

export interface DeprecatedElement {
    resourceType: string;
    path: string;
    deprecatedIn: FHIRVersion;
    removedIn?: FHIRVersion;
    replacement?: string;
    migrationHint: string;
}

export interface RenamedElement {
    resourceType: string;
    oldPath: string;
    newPath: string;
    changedIn: FHIRVersion;
}

// ============================================================================
// Deprecated Elements Database (R4 → R5 → R6)
// ============================================================================

const DEPRECATED_ELEMENTS: DeprecatedElement[] = [
    // Patient
    {
        resourceType: 'Patient',
        path: 'Patient.managingOrganization',
        deprecatedIn: 'R5',
        replacement: 'Patient.generalPractitioner',
        migrationHint: 'Use generalPractitioner with appropriate role instead'
    },

    // Encounter
    {
        resourceType: 'Encounter',
        path: 'Encounter.hospitalization',
        deprecatedIn: 'R5',
        replacement: 'Encounter.admission',
        migrationHint: 'hospitalization was renamed to admission in R5'
    },
    {
        resourceType: 'Encounter',
        path: 'Encounter.class',
        deprecatedIn: 'R5',
        migrationHint: 'class changed from Coding to CodeableConcept in R5'
    },

    // MedicationRequest
    {
        resourceType: 'MedicationRequest',
        path: 'MedicationRequest.medicationCodeableConcept',
        deprecatedIn: 'R5',
        replacement: 'MedicationRequest.medication',
        migrationHint: 'medication[x] consolidated to CodeableReference in R5'
    },
    {
        resourceType: 'MedicationRequest',
        path: 'MedicationRequest.medicationReference',
        deprecatedIn: 'R5',
        replacement: 'MedicationRequest.medication',
        migrationHint: 'Use medication with CodeableReference type'
    },

    // Observation
    {
        resourceType: 'Observation',
        path: 'Observation.performer',
        deprecatedIn: 'R6',
        migrationHint: 'performer may be replaced with more specific roles in R6'
    },

    // Condition
    {
        resourceType: 'Condition',
        path: 'Condition.asserter',
        deprecatedIn: 'R5',
        migrationHint: 'Consider using participant with asserter role instead'
    },

    // DiagnosticReport
    {
        resourceType: 'DiagnosticReport',
        path: 'DiagnosticReport.imagingStudy',
        deprecatedIn: 'R5',
        replacement: 'DiagnosticReport.study',
        migrationHint: 'imagingStudy renamed to study in R5'
    },

    // Procedure
    {
        resourceType: 'Procedure',
        path: 'Procedure.reasonReference',
        deprecatedIn: 'R5',
        replacement: 'Procedure.reason',
        migrationHint: 'reasonCode and reasonReference merged into reason (CodeableReference)'
    },

    // Bundle
    {
        resourceType: 'Bundle',
        path: 'Bundle.signature',
        deprecatedIn: 'R5',
        migrationHint: 'Bundle.signature moved to individual components in R5'
    },
];

const RENAMED_ELEMENTS: RenamedElement[] = [
    { resourceType: 'Encounter', oldPath: 'hospitalization', newPath: 'admission', changedIn: 'R5' },
    { resourceType: 'DiagnosticReport', oldPath: 'imagingStudy', newPath: 'study', changedIn: 'R5' },
    { resourceType: 'Procedure', oldPath: 'reasonCode', newPath: 'reason', changedIn: 'R5' },
    { resourceType: 'Procedure', oldPath: 'reasonReference', newPath: 'reason', changedIn: 'R5' },
    { resourceType: 'MedicationRequest', oldPath: 'requester', newPath: 'requester', changedIn: 'R5' }, // Type change
];

// ============================================================================
// New R5/R6 Required Elements
// ============================================================================

const _NEW_REQUIRED_ELEMENTS: { resourceType: string; path: string; addedIn: FHIRVersion; description: string }[] = [
    { resourceType: 'Encounter', path: 'Encounter.class', addedIn: 'R5', description: 'class now has 0..* cardinality with CodeableConcept' },
    { resourceType: 'Observation', path: 'Observation.triggeredBy', addedIn: 'R5', description: 'New element for triggered observations' },
];

// ============================================================================
// Version Compatibility Validator
// ============================================================================

export class VersionCompatibilityValidator {
    private config: VersionCompatibilityConfig;

    constructor(config?: Partial<VersionCompatibilityConfig>) {
        this.config = {
            targetVersion: 'R5',
            reportDeprecated: true,
            reportNewRequired: true,
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
    validate(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceType = resource?.resourceType;

        if (!resourceType) {
            return issues;
        }

        logger.debug(`[VersionValidator] Checking ${resourceType} for ${this.config.targetVersion} compatibility`);

        // Check deprecated elements
        if (this.config.reportDeprecated) {
            issues.push(...this.checkDeprecatedElements(resource, resourceType));
        }

        // Check renamed elements
        if (this.config.reportRenamed) {
            issues.push(...this.checkRenamedElements(resource, resourceType));
        }

        // Check for new required elements (missing)
        if (this.config.reportNewRequired) {
            issues.push(...this.checkNewRequiredElements(resource, resourceType));
        }

        return issues;
    }

    /**
     * Check for deprecated elements in resource
     */
    private checkDeprecatedElements(resource: any, resourceType: string): ValidationIssue[] {
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
    private checkRenamedElements(resource: any, resourceType: string): ValidationIssue[] {
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
     * Check for new required elements that are missing
     */
    private checkNewRequiredElements(_resource: any, _resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        // Placeholder for future implementation
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
    private getValueAtPath(obj: any, pathParts: string[]): any {
        let current = obj;
        for (const part of pathParts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }

    /**
     * Detect FHIR version from resource structure
     */
    detectVersion(resource: any): { detected: FHIRVersion; confidence: 'high' | 'medium' | 'low'; hints: string[] } {
        const hints: string[] = [];
        let detected: FHIRVersion = 'R4';
        let confidence: 'high' | 'medium' | 'low' = 'low';

        // Check fhirVersion in meta (most reliable)
        if (resource.meta?.profile) {
            for (const profile of resource.meta.profile) {
                if (profile.includes('/5.0/') || profile.includes('|5.0')) {
                    hints.push('Profile URL indicates R5');
                    detected = 'R5';
                    confidence = 'high';
                } else if (profile.includes('/6.0/') || profile.includes('|6.0')) {
                    hints.push('Profile URL indicates R6');
                    detected = 'R6';
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

        if (resourceType === 'MedicationRequest' && resource.medication?.concept) {
            hints.push('MedicationRequest.medication uses CodeableReference (R5+)');
            if (detected === 'R4') detected = 'R5';
            if (confidence === 'low') confidence = 'medium';
        }

        return { detected, confidence, hints };
    }
}

// Singleton
export const versionCompatibilityValidator = new VersionCompatibilityValidator();
