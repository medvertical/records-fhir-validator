import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export function validateGermanMedicationDosage(resource: any, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!shouldValidateGermanMedicationDosage(resource, profileUrl)) return issues;

    const dosagePath = resource.resourceType === 'MedicationStatement'
        ? 'MedicationStatement.dosage'
        : `${resource.resourceType}.dosageInstruction`;
    const dosages = resource.resourceType === 'MedicationStatement'
        ? resource.dosage
        : resource.dosageInstruction;

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
                resource.resourceType,
                path,
                'DosageStructuredOrFreeTextWarning',
                'Die Dosierungsangabe darf entweder nur als Freitext oder nur als vollständige strukturierte Information erfolgen — eine Mischung ist nicht erlaubt.',
                'warning',
            ));
        }

        if ((hasDosageTiming && !hasDosageDoseAndRate) || (!hasDosageTiming && hasDosageDoseAndRate)) {
            issues.push(createDosageConstraintIssue(
                resource.resourceType,
                path,
                'DosageStructuredRequiresBoth',
                'Wenn eine strukturierte Dosierungsangabe erfolgt, müssen sowohl timing als auch doseAndRate angegeben werden.',
                'error',
            ));
        }

        if (hasDosageText && /.*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+\s*[-–]\s*\d+.*/.test(String(dosage.text))) {
            issues.push(createDosageConstraintIssue(
                resource.resourceType,
                path,
                'DosageWarnungViererschemaInText',
                'Hinweis: In Dosage.text wurde ein Viererschema (z. B. 1-1-1-1) erkannt. Bitte prüfen, ob dies strukturiert abgebildet werden kann.',
                'warning',
            ));
        }
    }

    if (hasPureFreeTextDosage && dosages.length !== 1) {
        issues.push(createDosageConstraintIssue(
            resource.resourceType,
            dosagePath,
            'FreeTextSingleDosageOnlyWarning',
            'Wenn eine Dosierung als reiner Freitext angegeben ist, soll nur genau ein Dosage-Element existieren.',
            'warning',
        ));
    }

    return issues;
}

function shouldValidateGermanMedicationDosage(resource: any, profileUrl?: string): boolean {
    const profiles = [
        profileUrl,
        ...(Array.isArray(resource?.meta?.profile) ? resource.meta.profile : []),
    ].filter((profile): profile is string => typeof profile === 'string');

    return profiles.some(profile =>
        profile.includes('medizininformatik-initiative.de/fhir/core/modul-medikation/') ||
        profile.includes('ig.fhir.de/igs/medication/StructureDefinition/')
    );
}

function hasText(dosage: any): boolean {
    return typeof dosage?.text === 'string' && dosage.text.trim().length > 0;
}

function hasTiming(dosage: any): boolean {
    return dosage?.timing !== undefined && dosage.timing !== null;
}

function hasDoseAndRate(dosage: any): boolean {
    return Array.isArray(dosage?.doseAndRate) && dosage.doseAndRate.length > 0;
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
