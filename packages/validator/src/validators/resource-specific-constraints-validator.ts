/**
 * Resource-Specific Constraints Validator
 *
 * Validates resource-specific FHIRPath constraints that HAPI checks:
 *
 * Condition:
 * - con-3: problem-list Conditions need clinicalStatus unless entered-in-error
 * - con-4: abatement only when clinicalStatus is inactive/remission/resolved
 * - con-5: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error
 *
 * Patient:
 * - pat-1: contact SHALL have at least one of name, telecom, address, or organization
 *
 * Bundle:
 * - bdl-1: total only in searchset/history
 * - bdl-2: entry.search only in searchset
 *
 * AllergyIntolerance:
 * - ait-1: clinicalStatus SHALL be present if verificationStatus is not entered-in-error
 * - ait-2: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error
 *
 * Composition:
 * - cmp-1: section must have text, entries, or sub-sections (not empty)
 * - cmp-2: section entry only when emptyReason is absent
 *
 * Observation:
 * - obs-3: referenceRange must have at least a low, high, or text
 * - obs-6: dataAbsentReason SHALL only be present if value[x] is not present
 * - obs-7: if code matches a component.code, value SHALL NOT be present
 * - vs-3: vital-signs components without value[x] SHALL have dataAbsentReason
 *
 * German medication:
 * - DosageDE: free-text vs structured dosage invariants from the German
 *   medication IG, used transitively by MII Medikation profiles.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';
import { validateGermanMedicationDosage } from './resource-specific-medication-dosage';
import { validateObservationConstraints } from './resource-specific-observation-constraints';

// ============================================================================
// Resource-Specific Constraints
// ============================================================================

export class ResourceSpecificConstraintsValidator {

    /**
     * Validate resource-specific constraints
     */
    validate(resource: any, existingIssues: ValidationIssue[] = [], profileUrl?: string): ValidationIssue[] {
        if (!resource?.resourceType) return [];

        switch (resource.resourceType) {
            case 'Condition':
                return this.validateCondition(resource);
            case 'Patient':
                return this.validatePatient(resource, existingIssues);
            case 'Bundle':
                return this.validateBundle(resource);
            case 'AllergyIntolerance':
                return this.validateAllergyIntolerance(resource);
            case 'Composition':
                return this.validateComposition(resource);
            case 'Observation':
                return validateObservationConstraints(resource);
            case 'MedicationRequest':
            case 'MedicationDispense':
            case 'MedicationStatement':
                return validateGermanMedicationDosage(resource, profileUrl);
            default:
                return [];
        }
    }

    // ===========================================================================
    // Condition Constraints
    // ===========================================================================

    private validateCondition(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating Condition constraints');

        const clinicalStatus = this.getClinicalStatusCode(resource);

        const verificationStatus = this.getVerificationStatusCode(resource);

        // con-3: Condition.clinicalStatus SHALL be present if
        // verificationStatus is not entered-in-error and category is
        // problem-list-item. The published FHIRPath expression is easy to
        // mis-evaluate in JS because it compares CodeableConcept directly
        // to a code string.
        if (
            this.hasCode(resource.category, 'problem-list-item') &&
            verificationStatus !== 'entered-in-error' &&
            !clinicalStatus
        ) {
            issues.push(createValidationIssue({
                code: 'profile-constraint-warning',
                path: 'Condition.clinicalStatus',
                resourceType: 'Condition',
                customMessage: 'Constraint \'con-3\' failed: Condition.clinicalStatus SHALL be present if verificationStatus is not entered-in-error and category is problem-list-item',
                ruleId: 'con-3',
                severityOverride: 'warning',
                aspectOverride: 'profile',
                details: {
                    constraintKey: 'con-3',
                    originalSeverity: 'warning',
                },
            }));
        }

        // con-4: Evidence SHALL be present when verificationStatus is confirmed/unconfirmed/provisional
        // Actually con-4 is about bodySite - let me check the actual constraint
        // con-4: If condition has abatementDateTime, clinicalStatus must be inactive/remission/resolved
        if (resource.abatementDateTime || resource.abatementAge || resource.abatementPeriod ||
            resource.abatementRange || resource.abatementString) {
            const abatedStatuses = ['inactive', 'remission', 'resolved'];
            if (clinicalStatus && !abatedStatuses.includes(clinicalStatus)) {
                issues.push(createValidationIssue({
                    code: 'con-4-violation',
                    path: 'Condition.abatement[x]',
                    resourceType: 'Condition',
                    customMessage: 'con-4: If abatement is present, clinicalStatus SHALL be inactive/remission/resolved',
                    severityOverride: 'error',
                }));
            }
        }

        // con-5: Condition.clinicalStatus SHALL NOT be present if
        // verificationStatus is entered-in-error. Presence requirements for
        // problem-list Conditions are covered by con-3 above.
        if (verificationStatus === 'entered-in-error' && clinicalStatus) {
            issues.push(createValidationIssue({
                code: 'con-5-violation',
                path: 'Condition.clinicalStatus',
                resourceType: 'Condition',
                customMessage: 'con-5: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error',
                severityOverride: 'error',
            }));
        }

        return issues;
    }

    private getClinicalStatusCode(condition: any): string | null {
        return condition.clinicalStatus?.coding?.[0]?.code || null;
    }

    private getVerificationStatusCode(condition: any): string | null {
        return condition.verificationStatus?.coding?.[0]?.code || null;
    }

    private hasCode(value: any, code: string): boolean {
        const values = Array.isArray(value) ? value : value ? [value] : [];

        return values.some(item => {
            if (item?.code === code) return true;
            if (Array.isArray(item?.coding)) {
                return item.coding.some((coding: any) => coding?.code === code);
            }
            return false;
        });
    }

    // ===========================================================================
    // Patient Constraints
    // ===========================================================================

    private validatePatient(resource: any, existingIssues: ValidationIssue[] = []): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating Patient constraints');

        // pat-1: contact SHALL have at least one of name, telecom, address, or organization
        if (resource.contact && Array.isArray(resource.contact)) {
            for (let i = 0; i < resource.contact.length; i++) {
                const contact = resource.contact[i];
                const hasName = contact.name && Object.keys(contact.name).length > 0;
                const hasTelecom = contact.telecom && Array.isArray(contact.telecom) && contact.telecom.length > 0;
                const hasAddress = contact.address && Object.keys(contact.address).length > 0;
                const hasOrganization = contact.organization && Object.keys(contact.organization).length > 0;

                if (!hasName && !hasTelecom && !hasAddress && !hasOrganization) {
                    issues.push(createValidationIssue({
                        code: 'pat-1-violation',
                        path: `Patient.contact[${i}]`,
                        resourceType: 'Patient',
                        customMessage: 'pat-1: contact SHALL have at least one of name, telecom, address, or organization',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        // Business rule: birthDate must not be in the future. FHIR has no
        // structural constraint on this — it's a Records differentiator
        // over HAPI. Data-entry defaults (year 2099, year 1900 stub) and
        // timezone-shift bugs produce future dates in real customer data.
        //
        // aspectOverride='invariant' is necessary because the code's
        // metadata declares aspect='customRule' but this validator runs
        // inside the invariant aspect group (see multi-aspect-validate-
        // callback.ts). Without the override the issue ends up in the
        // wrong bucket and gets filtered out when customRule execution
        // is disabled by the caller's settings.
        if (typeof resource.birthDate === 'string' && resource.birthDate.length > 0) {
            const bd = new Date(resource.birthDate);
            const hasProfileMaxValueIssue = existingIssues.some(issue =>
                issue.code === 'profile-max-value-duration-violation' &&
                issue.path === 'Patient.birthDate'
            );

            if (!Number.isNaN(bd.getTime()) && bd.getTime() > Date.now() && !hasProfileMaxValueIssue) {
                issues.push(createValidationIssue({
                    code: 'business-future-birth-date',
                    path: 'Patient.birthDate',
                    resourceType: 'Patient',
                    customMessage:
                        `Patient.birthDate is in the future (${resource.birthDate}). ` +
                        `This is almost always a data-entry or timezone bug; age-based ` +
                        `dosage and cohort queries will mis-classify the patient.`,
                    severityOverride: 'warning',
                    aspectOverride: 'invariant',
                }));
            }
        }

        return issues;
    }

    // ===========================================================================
    // Bundle Constraints
    // ===========================================================================

    private validateBundle(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating Bundle constraints');

        const bundleType = resource.type;

        // bdl-1: total only in searchset/history
        if (resource.total !== undefined) {
            if (bundleType !== 'searchset' && bundleType !== 'history') {
                issues.push(createValidationIssue({
                    code: 'bdl-1-violation',
                    path: 'Bundle.total',
                    resourceType: 'Bundle',
                    customMessage: 'bdl-1: total only when type is searchset or history',
                    severityOverride: 'error',
                }));
            }
        }

        // bdl-2: entry.search only in searchset
        if (resource.entry && Array.isArray(resource.entry)) {
            for (let i = 0; i < resource.entry.length; i++) {
                if (resource.entry[i].search && bundleType !== 'searchset') {
                    issues.push(createValidationIssue({
                        code: 'bdl-2-violation',
                        path: `Bundle.entry[${i}].search`,
                        resourceType: 'Bundle',
                        customMessage: 'bdl-2: entry.search only when type is searchset',
                        severityOverride: 'error',
                    }));
                    break; // One is enough
                }
            }
        }

        // bdl-3: entry.request only in batch/transaction/history
        if (resource.entry && Array.isArray(resource.entry)) {
            const validRequestTypes = ['batch', 'transaction', 'history'];
            for (let i = 0; i < resource.entry.length; i++) {
                if (resource.entry[i].request && !validRequestTypes.includes(bundleType)) {
                    issues.push(createValidationIssue({
                        code: 'bdl-3-violation',
                        path: `Bundle.entry[${i}].request`,
                        resourceType: 'Bundle',
                        customMessage: 'bdl-3: entry.request only when type is batch/transaction/history',
                        severityOverride: 'error',
                    }));
                    break;
                }
            }
        }

        // bdl-4: entry.response only in batch-response/transaction-response/history
        if (resource.entry && Array.isArray(resource.entry)) {
            const validResponseTypes = ['batch-response', 'transaction-response', 'history'];
            for (let i = 0; i < resource.entry.length; i++) {
                if (resource.entry[i].response && !validResponseTypes.includes(bundleType)) {
                    issues.push(createValidationIssue({
                        code: 'bdl-4-violation',
                        path: `Bundle.entry[${i}].response`,
                        resourceType: 'Bundle',
                        customMessage: 'bdl-4: entry.response only when type is batch-response/transaction-response/history',
                        severityOverride: 'error',
                    }));
                    break;
                }
            }
        }

        return issues;
    }

    // ===========================================================================
    // AllergyIntolerance Constraints
    // ===========================================================================

    private validateAllergyIntolerance(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating AllergyIntolerance constraints');

        const clinicalStatus = resource.clinicalStatus?.coding?.[0]?.code || null;
        const verificationStatus = resource.verificationStatus?.coding?.[0]?.code || null;

        // ait-1: clinicalStatus SHALL be present if verificationStatus is not entered-in-error
        // Expression: verificationStatus.coding.where(system='http://terminology.hl7.org/CodeSystem/allergyintolerance-verification'
        //   and code='entered-in-error').exists() or clinicalStatus.exists()
        if (verificationStatus !== 'entered-in-error' && !clinicalStatus) {
            issues.push(createValidationIssue({
                code: 'ait-1-violation',
                path: 'AllergyIntolerance.clinicalStatus',
                resourceType: 'AllergyIntolerance',
                customMessage: 'ait-1: AllergyIntolerance.clinicalStatus SHALL be present if verificationStatus is not entered-in-error',
                severityOverride: 'error',
            }));
        }

        // ait-2: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error
        // Expression: verificationStatus.coding.where(system='http://terminology.hl7.org/CodeSystem/allergyintolerance-verification'
        //   and code='entered-in-error').exists() implies clinicalStatus.empty()
        if (verificationStatus === 'entered-in-error' && clinicalStatus) {
            issues.push(createValidationIssue({
                code: 'ait-2-violation',
                path: 'AllergyIntolerance.clinicalStatus',
                resourceType: 'AllergyIntolerance',
                customMessage: 'ait-2: AllergyIntolerance.clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error',
                severityOverride: 'error',
            }));
        }

        return issues;
    }

    // ===========================================================================
    // Composition Constraints
    // ===========================================================================

    private validateComposition(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating Composition constraints');

        if (resource.section && Array.isArray(resource.section)) {
            for (let i = 0; i < resource.section.length; i++) {
                issues.push(...this.validateCompositionSection(resource.section[i], `Composition.section[${i}]`));
            }
        }

        return issues;
    }

    private validateCompositionSection(section: any, path: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // cmp-1: A section must contain at least one of text, entry, or sub-section
        // Expression: text.exists() or entry.exists() or section.exists()
        const hasText = section.text && section.text.div;
        const hasEntry = section.entry && Array.isArray(section.entry) && section.entry.length > 0;
        const hasSubSection = section.section && Array.isArray(section.section) && section.section.length > 0;

        if (!hasText && !hasEntry && !hasSubSection) {
            issues.push(createValidationIssue({
                code: 'cmp-1-violation',
                path,
                resourceType: 'Composition',
                customMessage: 'cmp-1: A section must contain at least one of text, entry, or sub-section',
                severityOverride: 'error',
            }));
        }

        // cmp-2: A section can only have an emptyReason if it is empty
        // Expression: emptyReason.empty() or entry.empty()
        if (section.emptyReason && hasEntry) {
            issues.push(createValidationIssue({
                code: 'cmp-2-violation',
                path,
                resourceType: 'Composition',
                customMessage: 'cmp-2: A section can only have an emptyReason if it has no entries',
                severityOverride: 'error',
            }));
        }

        // Recurse into sub-sections
        if (hasSubSection) {
            for (let i = 0; i < section.section.length; i++) {
                issues.push(...this.validateCompositionSection(section.section[i], `${path}.section[${i}]`));
            }
        }

        return issues;
    }

}

// Singleton
export const resourceSpecificConstraintsValidator = new ResourceSpecificConstraintsValidator();
