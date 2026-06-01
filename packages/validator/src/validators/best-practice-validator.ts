/**
 * Best Practice Validator
 * 
 * Validates best practice recommendations that HAPI reports as warnings.
 * These are not strict FHIR requirements but recommended practices.
 * 
 * German locale equivalents:
 * - "Alle Observations sollten ein effectiveDateTime oder eine effectivePeriode haben"
 * - "Alle Observations sollten einen Performer haben"
 */

import type { ValidationIssue } from '../types';
import { logger as _logger } from '../logger';

export interface BestPracticeValidationContext {
    resource: any;
    resourceType: string;
    profileUrl?: string;
}

/**
 * Best Practice Validator
 * 
 * Provides warnings for common best practices in FHIR resources.
 * These match HAPI's informational messages.
 */
export class BestPracticeValidator {

    /**
     * Validate best practices for a resource
     */
    validate(context: BestPracticeValidationContext): ValidationIssue[] {
        const { resource, resourceType } = context;
        const issues: ValidationIssue[] = [];

        // General best practices for all DomainResources
        issues.push(...this.validateGeneralBestPractices(resource, resourceType));

        // Resource-specific best practices
        switch (resourceType) {
            case 'Observation':
                issues.push(...this.validateObservationBestPractices(resource));
                break;
            case 'Patient':
                issues.push(...this.validatePatientBestPractices(resource));
                break;
            case 'Condition':
                issues.push(...this.validateConditionBestPractices(resource));
                break;
            case 'DiagnosticReport':
                issues.push(...this.validateDiagnosticReportBestPractices(resource));
                break;
            case 'Encounter':
                issues.push(...this.validateEncounterBestPractices(resource));
                break;
        }

        return issues;
    }

    /**
     * General best practices for all DomainResources
     */
    private validateGeneralBestPractices(_resource: any, _resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Note: dom-6, dom-2, dom-4, dom-5 are now handled by ConstraintValidator (Invariants)
        // This prevents duplicate reporting of the same issues.

        // We only keep unique best practice checks here if they aren't covered by standard invariants.
        // Currently, contained resources text check was here but it is also largely covered by invariants or structural.

        return issues;
    }

    /**
     * Best practice checks for Observation resources
     */
    private validateObservationBestPractices(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for effectiveDateTime or effectivePeriod
        const hasEffective =
            resource.effectiveDateTime ||
            resource.effectivePeriod ||
            resource.effectiveInstant ||
            resource.effectiveTiming;

        if (!hasEffective) {
            issues.push({
                id: `best-practice-observation-effective-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-missing-effective',
                message: 'All Observations should have an `effectiveDateTime` or an `effectivePeriod`',
                path: 'Observation.effective[x]',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check for performer
        const hasPerformer = resource.performer &&
            (Array.isArray(resource.performer) ? resource.performer.length > 0 : true);

        if (!hasPerformer) {
            issues.push({
                id: `best-practice-observation-performer-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-missing-performer',
                message: 'All Observations should have a `performer`',
                path: 'Observation.performer',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // obs-6: dataAbsentReason SHALL only be present if value[x] is not present
        // Handled by Invariant Validator (obs-6)

        // We removed the manual check here to avoid duplicates.


        // HAPI does not emit generic interpretation/method best-practice
        // advisories for ordinary Observation measurements. Keeping those
        // as broad Records-only rules creates high-volume noise on realistic
        // lab/vital-sign datasets, so they should come from explicit profiles
        // or configured rule packs instead of the universal best-practice pass.

        return issues;
    }

    /**
     * Best practice checks for Patient resources
     */
    private validatePatientBestPractices(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for identifier - critical for patient matching
        const hasIdentifier = resource.identifier &&
            (Array.isArray(resource.identifier) ? resource.identifier.length > 0 : true);

        if (!hasIdentifier) {
            issues.push({
                id: `best-practice-patient-identifier-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-patient-identifier',
                message: 'Patient resources should have at least one identifier for reliable patient matching',
                path: 'Patient.identifier',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check for name - required for human identification
        const hasName = resource.name &&
            (Array.isArray(resource.name) ? resource.name.length > 0 : true);

        if (!hasName) {
            issues.push({
                id: `best-practice-patient-name-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-patient-name',
                message: 'Patient resources should have at least one name',
                path: 'Patient.name',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check for narrative (dom-6)
        const hasNarrative = resource.text && resource.text.div;
        if (!hasNarrative) {
            issues.push({
                id: `best-practice-narrative-${Date.now()}`,
                aspect: 'structural',
                severity: 'info', // HAPI treats dom-6 as informational by default
                code: 'dom-6',
                message: 'A resource should have narrative for robust management',
                path: 'Patient.text',
                tags: ['best-practice', 'narrative'],
                timestamp: new Date()
            });
        }

        return issues;
    }

    /**
     * Best practice checks for Condition resources
     */
    private validateConditionBestPractices(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for code display or text - ensures human readability
        const hasCodeDisplay = resource.code && (
            resource.code.text ||
            (resource.code.coding && resource.code.coding.some((c: any) => c.display))
        );

        if (resource.code && !hasCodeDisplay) {
            issues.push({
                id: `best-practice-condition-code-display-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-condition-code-display',
                message: 'Condition.code should include display text (code.text or coding.display) for human readability',
                path: 'Condition.code',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check clinicalStatus - should be present unless entered-in-error
        const verificationStatus = resource.verificationStatus?.coding?.[0]?.code;
        const hasClinicalStatus = resource.clinicalStatus;

        if (!hasClinicalStatus && verificationStatus !== 'entered-in-error') {
            issues.push({
                id: `best-practice-condition-clinical-status-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-condition-clinical-status',
                message: 'Condition resources should have clinicalStatus (unless verificationStatus is entered-in-error)',
                path: 'Condition.clinicalStatus',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        return issues;
    }

    /**
     * Best practice checks for DiagnosticReport resources
     */
    private validateDiagnosticReportBestPractices(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for effective[x] - temporal context
        const hasEffective = resource.effectiveDateTime || resource.effectivePeriod;

        if (!hasEffective) {
            issues.push({
                id: `best-practice-diagreport-effective-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-diagreport-effective',
                message: 'DiagnosticReport should have effectiveDateTime or effectivePeriod for temporal context',
                path: 'DiagnosticReport',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check for issued - when report was released
        if (!resource.issued) {
            issues.push({
                id: `best-practice-diagreport-issued-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-diagreport-issued',
                message: 'DiagnosticReport should have issued timestamp indicating when the report was released',
                path: 'DiagnosticReport.issued',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        return issues;
    }

    /**
     * Best practice checks for Encounter resources
     */
    private validateEncounterBestPractices(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for period.start - when encounter began
        const hasPeriodStart = resource.period?.start;

        if (!hasPeriodStart) {
            issues.push({
                id: `best-practice-encounter-period-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-encounter-period',
                message: 'Encounter should have period.start indicating when the encounter began',
                path: 'Encounter.period',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        // Check for class - type of encounter
        if (!resource.class) {
            issues.push({
                id: `best-practice-encounter-class-${Date.now()}`,
                aspect: 'structural',
                // Best-practice advisories are informational — downstream
                // tooling (parity-classifier, fix-suggestions) already
                // classifies them as informational, and HAPI/Java does not
                // surface them as warnings. Keeping them at `warning` used
                // to pollute the fhir-test-cases OperationOutcome diff.
                severity: 'information',
                code: 'best-practice-encounter-class',
                message: 'Encounter should have class indicating the type of encounter (e.g., ambulatory, emergency)',
                path: 'Encounter.class',
                tags: ['best-practice'],
                timestamp: new Date()
            });
        }

        return issues;
    }
}
