import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

export function validateGermanMedicationDosage(resource: unknown, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const medication = asRecord(resource);
    if (!medication || !shouldValidateGermanMedicationDosage(medication, profileUrl)) return issues;
    const resourceType = typeof medication.resourceType === 'string'
        ? medication.resourceType
        : 'MedicationRequest';

    const dosagePath = resourceType === 'MedicationStatement'
        ? 'MedicationStatement.dosage'
        : `${resourceType}.dosageInstruction`;
    const dosages = resourceType === 'MedicationStatement'
        ? medication.dosage
        : medication.dosageInstruction;

    if (!Array.isArray(dosages) || dosages.length === 0) return issues;

    const hasPureFreeTextDosage = dosages.some(dosage =>
        hasText(dosage) && !hasTiming(dosage) && !hasDoseAndRate(dosage)
    );

    for (let i = 0; i < dosages.length; i++) {
        const dosage = dosages[i];
        const path = `${dosagePath}[${i}]`;
        const hasDosageText = hasText(dosage);
        const hasDosageTiming = hasTiming(dosage);
        const hasDosageDoseAndRate = hasDoseAndRate(dosage);
        const isPureFreeText = hasDosageText && !hasDosageTiming && !hasDosageDoseAndRate;
        const isStructuredOrPartial = !hasDosageText && (hasDosageTiming || hasDosageDoseAndRate);

        if (!isPureFreeText && !isStructuredOrPartial) {
            issues.push(createDosageConstraintIssue(
                resourceType,
                path,
                'DosageStructuredOrFreeTextWarning',
                'Die Dosierungsangabe darf entweder nur als Freitext oder nur als vollständige strukturierte Information erfolgen — eine Mischung ist nicht erlaubt.',
                'warning',
            ));
        }

        if ((hasDosageTiming && !hasDosageDoseAndRate) || (!hasDosageTiming && hasDosageDoseAndRate)) {
            issues.push(createDosageConstraintIssue(
                resourceType,
                path,
                'DosageStructuredRequiresBoth',
                'Wenn eine strukturierte Dosierungsangabe erfolgt, müssen sowohl timing als auch doseAndRate angegeben werden.',
                'error',
            ));
        }

        const dosageText = asRecord(dosage)?.text;
        if (hasDosageText && typeof dosageText === 'string' && /.*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+.*/.test(dosageText)) {
            issues.push(createDosageConstraintIssue(
                resourceType,
                path,
                'DosageWarnungViererschemaInText',
                'Hinweis: In Dosage.text wurde ein Viererschema (z. B. 1-1-1-1) erkannt. Bitte prüfen, ob dies strukturiert abgebildet werden kann.',
                'warning',
            ));
        }
    }

    if (hasPureFreeTextDosage && dosages.length !== 1) {
        issues.push(createDosageConstraintIssue(
            resourceType,
            dosagePath,
            'FreeTextSingleDosageOnlyWarning',
            'Wenn eine Dosierung als reiner Freitext angegeben ist, soll nur genau ein Dosage-Element existieren.',
            'warning',
        ));
    }

    return issues;
}

function shouldValidateGermanMedicationDosage(
    resource: Record<string, unknown>,
    profileUrl?: string,
): boolean {
    const declaredProfiles = asRecord(resource.meta)?.profile;
    const profiles = [
        profileUrl,
        ...(Array.isArray(declaredProfiles) ? declaredProfiles : []),
    ].filter((profile): profile is string => typeof profile === 'string');

    return profiles.some(profile =>
        profile.includes('medizininformatik-initiative.de/fhir/core/modul-medikation/') ||
        profile.includes('ig.fhir.de/igs/medication/StructureDefinition/')
    );
}

function hasText(dosage: unknown): boolean {
    const text = asRecord(dosage)?.text;
    return typeof text === 'string' && text.trim().length > 0;
}

function hasTiming(dosage: unknown): boolean {
    const timing = asRecord(dosage)?.timing;
    return timing !== undefined && timing !== null;
}

function hasDoseAndRate(dosage: unknown): boolean {
    const doseAndRate = asRecord(dosage)?.doseAndRate;
    return Array.isArray(doseAndRate) && doseAndRate.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function createDosageConstraintIssue(
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
