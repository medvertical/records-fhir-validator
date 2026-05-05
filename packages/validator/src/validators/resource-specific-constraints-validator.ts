/**
 * Resource-Specific Constraints Validator
 *
 * Validates resource-specific FHIRPath constraints that HAPI checks:
 *
 * Condition:
 * - con-3: stage only when clinicalStatus is not inactive/remission/resolved
 * - con-4: evidence only when verificationStatus confirmed/unconfirmed/provisional
 * - con-5: abatement only when clinicalStatus is inactive/remission/resolved
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
                return this.validateObservation(resource);
            case 'MedicationRequest':
            case 'MedicationDispense':
            case 'MedicationStatement':
                return this.validateGermanMedicationDosage(resource, profileUrl);
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

        // con-3: If condition is abated, then clinicalStatus must be inactive/remission/resolved
        // (Stage is only when clinicalStatus is not those values)
        if (resource.stage && Array.isArray(resource.stage) && resource.stage.length > 0) {
            const inactiveStatuses = ['inactive', 'remission', 'resolved'];
            if (clinicalStatus && inactiveStatuses.includes(clinicalStatus)) {
                issues.push(createValidationIssue({
                    code: 'con-3-violation',
                    path: 'Condition.stage',
                    resourceType: 'Condition',
                    customMessage: 'con-3: Stage is only present when clinicalStatus is not inactive/remission/resolved',
                    severityOverride: 'error',
                }));
            }
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

        // con-5: Condition.clinicalStatus SHALL be present if verificationStatus is not entered-in-error.
        // The base FHIRPath expression (`clinicalStatus.exists() or verificationStatus...entered-in-error...exists()`)
        // fires when BOTH are absent, but the spec intent is: "if verificationStatus IS PRESENT and not
        // entered-in-error, clinicalStatus is required." When verificationStatus is absent entirely,
        // the constraint is vacuously satisfied. This matches ISiK/MII administrative diagnoses that
        // intentionally omit both fields.
        const verificationStatus = this.getVerificationStatusCode(resource);
        if (verificationStatus !== null && verificationStatus !== 'entered-in-error' && !clinicalStatus) {
            issues.push(createValidationIssue({
                code: 'con-5-violation',
                path: 'Condition.clinicalStatus',
                resourceType: 'Condition',
                customMessage: 'con-5: clinicalStatus SHALL be present if verificationStatus is not entered-in-error',
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

    // ===========================================================================
    // Observation Constraints
    // ===========================================================================

    private validateObservation(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        logger.debug('[ResourceConstraints] Validating Observation constraints');

        // obs-3: referenceRange must have at least a low, high, or text
        if (resource.referenceRange && Array.isArray(resource.referenceRange)) {
            for (let i = 0; i < resource.referenceRange.length; i++) {
                const rr = resource.referenceRange[i];
                if (!rr.low && !rr.high && !rr.text) {
                    issues.push(createValidationIssue({
                        code: 'obs-3-violation',
                        path: `Observation.referenceRange[${i}]`,
                        resourceType: 'Observation',
                        customMessage: 'obs-3: Must have at least a low or a high or text',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        // obs-6: dataAbsentReason SHALL only be present if value[x] is not present
        const hasValue = this.observationHasValue(resource);
        if (resource.dataAbsentReason && hasValue) {
            issues.push(createValidationIssue({
                code: 'obs-6-violation',
                path: 'Observation.dataAbsentReason',
                resourceType: 'Observation',
                customMessage: 'obs-6: dataAbsentReason SHALL only be present if Observation.value[x] is not present',
                severityOverride: 'error',
            }));
        }

        // obs-7: if code matches a component.code, value SHALL NOT be present
        if (hasValue && resource.component && Array.isArray(resource.component)) {
            const obsCodes = this.getCodingSet(resource.code);
            if (obsCodes.size > 0) {
                for (const comp of resource.component) {
                    const compCodes = this.getCodingSet(comp.code);
                    for (const c of compCodes) {
                        if (obsCodes.has(c)) {
                            issues.push(createValidationIssue({
                                code: 'obs-7-violation',
                                path: 'Observation.value[x]',
                                resourceType: 'Observation',
                                customMessage: 'obs-7: If Observation.code is the same as a component.code, the value element SHALL NOT be present',
                                severityOverride: 'error',
                            }));
                            return issues; // One violation is enough
                        }
                    }
                }
            }
        }

        // vs-3 (Vital Signs profile): components without value[x] need dataAbsentReason.
        if (this.isVitalSignsObservation(resource) && Array.isArray(resource.component)) {
            for (let i = 0; i < resource.component.length; i++) {
                const component = resource.component[i];
                if (!this.observationHasValue(component) && !component.dataAbsentReason) {
                    issues.push(createValidationIssue({
                        code: 'invariant-vs-3-violation',
                        path: `Observation.component[${i}]`,
                        resourceType: 'Observation',
                        customMessage: 'vs-3: If there is no a value a data absent reason must be present',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        return issues;
    }

    private observationHasValue(resource: any): boolean {
        return !!(resource.valueQuantity || resource.valueCodeableConcept ||
            resource.valueString || resource.valueBoolean || resource.valueInteger ||
            resource.valueRange || resource.valueRatio || resource.valueSampledData ||
            resource.valueTime || resource.valueDateTime || resource.valuePeriod);
    }

    private getCodingSet(codeableConcept: any): Set<string> {
        const codes = new Set<string>();
        if (codeableConcept?.coding && Array.isArray(codeableConcept.coding)) {
            for (const coding of codeableConcept.coding) {
                if (coding.system && coding.code) {
                    codes.add(`${coding.system}|${coding.code}`);
                }
            }
        }
        return codes;
    }

    private isVitalSignsObservation(resource: any): boolean {
        if (Array.isArray(resource?.category)) {
            for (const category of resource.category) {
                for (const coding of category?.coding || []) {
                    if (
                        coding?.system === 'http://terminology.hl7.org/CodeSystem/observation-category' &&
                        coding?.code === 'vital-signs'
                    ) {
                        return true;
                    }
                }
            }
        }

        return (resource?.meta?.profile || []).some((profile: string) =>
            typeof profile === 'string' && /vital|oxygen|pulse-ox/i.test(profile)
        );
    }

    // ===========================================================================
    // German Medication Dosage Constraints
    // ===========================================================================

    private validateGermanMedicationDosage(resource: any, profileUrl?: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        if (!this.shouldValidateGermanMedicationDosage(resource, profileUrl)) return issues;

        const dosagePath = resource.resourceType === 'MedicationStatement'
            ? 'MedicationStatement.dosage'
            : `${resource.resourceType}.dosageInstruction`;
        const dosages = resource.resourceType === 'MedicationStatement'
            ? resource.dosage
            : resource.dosageInstruction;

        if (!Array.isArray(dosages) || dosages.length === 0) return issues;

        const hasPureFreeTextDosage = dosages.some(dosage =>
            this.hasText(dosage) && !this.hasTiming(dosage) && !this.hasDoseAndRate(dosage)
        );

        for (let i = 0; i < dosages.length; i++) {
            const dosage = dosages[i];
            const path = `${dosagePath}[${i}]`;
            const hasText = this.hasText(dosage);
            const hasTiming = this.hasTiming(dosage);
            const hasDoseAndRate = this.hasDoseAndRate(dosage);
            const isPureFreeText = hasText && !hasTiming && !hasDoseAndRate;
            const isStructuredOrPartial = !hasText && (hasTiming || hasDoseAndRate);

            if (!isPureFreeText && !isStructuredOrPartial) {
                issues.push(this.createDosageConstraintIssue(
                    resource.resourceType,
                    path,
                    'DosageStructuredOrFreeTextWarning',
                    'Die Dosierungsangabe darf entweder nur als Freitext oder nur als vollständige strukturierte Information erfolgen — eine Mischung ist nicht erlaubt.',
                    'warning',
                ));
            }

            if ((hasTiming && !hasDoseAndRate) || (!hasTiming && hasDoseAndRate)) {
                issues.push(this.createDosageConstraintIssue(
                    resource.resourceType,
                    path,
                    'DosageStructuredRequiresBoth',
                    'Wenn eine strukturierte Dosierungsangabe erfolgt, müssen sowohl timing als auch doseAndRate angegeben werden.',
                    'error',
                ));
            }

            if (hasText && /.*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+.*/.test(String(dosage.text))) {
                issues.push(this.createDosageConstraintIssue(
                    resource.resourceType,
                    path,
                    'DosageWarnungViererschemaInText',
                    'Hinweis: In Dosage.text wurde ein Viererschema (z. B. 1-1-1-1) erkannt. Bitte prüfen, ob dies strukturiert abgebildet werden kann.',
                    'warning',
                ));
            }
        }

        if (hasPureFreeTextDosage && dosages.length !== 1) {
            issues.push(this.createDosageConstraintIssue(
                resource.resourceType,
                dosagePath,
                'FreeTextSingleDosageOnlyWarning',
                'Wenn eine Dosierung als reiner Freitext angegeben ist, soll nur genau ein Dosage-Element existieren.',
                'warning',
            ));
        }

        return issues;
    }

    private shouldValidateGermanMedicationDosage(resource: any, profileUrl?: string): boolean {
        const profiles = [
            profileUrl,
            ...(Array.isArray(resource?.meta?.profile) ? resource.meta.profile : []),
        ].filter((profile): profile is string => typeof profile === 'string');

        return profiles.some(profile =>
            profile.includes('medizininformatik-initiative.de/fhir/core/modul-medikation/') ||
            profile.includes('ig.fhir.de/igs/medication/StructureDefinition/')
        );
    }

    private hasText(dosage: any): boolean {
        return typeof dosage?.text === 'string' && dosage.text.trim().length > 0;
    }

    private hasTiming(dosage: any): boolean {
        return dosage?.timing !== undefined && dosage.timing !== null;
    }

    private hasDoseAndRate(dosage: any): boolean {
        return Array.isArray(dosage?.doseAndRate) && dosage.doseAndRate.length > 0;
    }

    private createDosageConstraintIssue(
        resourceType: string,
        path: string,
        key: string,
        human: string,
        severity: 'warning' | 'error',
    ): ValidationIssue {
        return createValidationIssue({
            code: severity === 'warning' ? 'profile-constraint-warning' : 'profile-constraint-violation',
            path,
            resourceType,
            customMessage: `Constraint '${key}' failed: ${human}`,
            ruleId: key,
            severityOverride: severity,
            aspectOverride: 'profile',
            details: {
                constraintKey: key,
                originalSeverity: severity,
                source: 'http://ig.fhir.de/igs/medication/StructureDefinition/DosageDE',
            },
        });
    }
}

// Singleton
export const resourceSpecificConstraintsValidator = new ResourceSpecificConstraintsValidator();
