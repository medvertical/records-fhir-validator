/**
 * Informational best-practice recommendations that mirror HAPI/Java advice.
 */

import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

type FhirRecord = Record<string, unknown>;

interface BestPracticeRule {
    code: string;
    message: string;
    path: string;
    shouldReport: (resource: FhirRecord) => boolean;
    tags?: string[];
}

export interface BestPracticeValidationContext {
    resource: unknown;
    resourceType: string;
    profileUrl?: string;
}

export type BestPracticeSettings = Pick<
    ValidationSettings,
    'enableBestPracticeChecks' | 'bestPracticeSeverity'
>;

const RULES_BY_RESOURCE_TYPE: Readonly<Record<string, BestPracticeRule[]>> = {
    Observation: [
        {
            code: 'best-practice-missing-effective',
            message:
                'All Observations should have an `effectiveDateTime` or an `effectivePeriod`',
            path: 'Observation.effective[x]',
            shouldReport: resource => !hasAnyValue(resource, [
                'effectiveDateTime',
                'effectivePeriod',
                'effectiveInstant',
                'effectiveTiming',
            ]),
        },
        {
            code: 'best-practice-missing-performer',
            message: 'All Observations should have a `performer`',
            path: 'Observation.performer',
            shouldReport: resource => !hasValue(resource.performer),
        },
    ],
    Patient: [
        {
            code: 'best-practice-patient-identifier',
            message:
                'Patient resources should have at least one identifier for reliable patient matching',
            path: 'Patient.identifier',
            shouldReport: resource => !hasValue(resource.identifier),
        },
        {
            code: 'best-practice-patient-name',
            message: 'Patient resources should have at least one name',
            path: 'Patient.name',
            shouldReport: resource => !hasValue(resource.name),
        },
        {
            code: 'dom-6',
            message: 'A resource should have narrative for robust management',
            path: 'Patient.text',
            tags: ['best-practice', 'narrative'],
            shouldReport: resource => {
                const text = toRecord(resource.text);
                return !isNonEmptyString(text?.div);
            },
        },
    ],
    Condition: [
        {
            code: 'best-practice-condition-code-display',
            message:
                'Condition.code should include display text (code.text or coding.display) for human readability',
            path: 'Condition.code',
            shouldReport: resource => {
                const code = toRecord(resource.code);
                return code !== undefined && !hasCodeDisplay(code);
            },
        },
        {
            code: 'best-practice-condition-clinical-status',
            message:
                'Condition resources should have clinicalStatus (unless verificationStatus is entered-in-error)',
            path: 'Condition.clinicalStatus',
            shouldReport: resource =>
                !hasValue(resource.clinicalStatus)
                && !hasCodingCode(resource.verificationStatus, 'entered-in-error'),
        },
    ],
    DiagnosticReport: [
        {
            code: 'best-practice-diagreport-effective',
            message:
                'DiagnosticReport should have effectiveDateTime or effectivePeriod for temporal context',
            path: 'DiagnosticReport.effective[x]',
            shouldReport: resource => !hasAnyValue(resource, [
                'effectiveDateTime',
                'effectivePeriod',
            ]),
        },
        {
            code: 'best-practice-diagreport-issued',
            message:
                'DiagnosticReport should have issued timestamp indicating when the report was released',
            path: 'DiagnosticReport.issued',
            shouldReport: resource => !hasValue(resource.issued),
        },
    ],
    Encounter: [
        {
            code: 'best-practice-encounter-period',
            message:
                'Encounter should have period.start indicating when the encounter began',
            path: 'Encounter.period.start',
            shouldReport: resource => !hasValue(toRecord(resource.period)?.start),
        },
        {
            code: 'best-practice-encounter-class',
            message:
                'Encounter should have class indicating the type of encounter (e.g., ambulatory, emergency)',
            path: 'Encounter.class',
            shouldReport: resource => !hasValue(resource.class),
        },
    ],
};

export class BestPracticeValidator {
    validate(context: BestPracticeValidationContext): ValidationIssue[] {
        const resource = toRecord(context.resource);
        if (!resource) return [];

        const resourceType = getResourceType(resource, context.resourceType);
        const rules = RULES_BY_RESOURCE_TYPE[resourceType] ?? [];
        return rules.flatMap(rule =>
            rule.shouldReport(resource)
                ? [createBestPracticeIssue(
                    rule,
                    resourceType,
                    context.profileUrl,
                )]
                : []
        );
    }
}

/**
 * Every execution path (multi-aspect structural aspect, package
 * single-resource pipeline, server single-aspect fallback) must gate and
 * escalate best-practice findings identically, so the settings mapping lives
 * here once instead of at each call site.
 */
export function validateBestPractices(
    validator: Pick<BestPracticeValidator, 'validate'>,
    context: BestPracticeValidationContext,
    settings?: BestPracticeSettings,
): ValidationIssue[] {
    if (settings?.enableBestPracticeChecks === false) return [];
    const issues = validator.validate(context);
    if (settings?.bestPracticeSeverity !== 'warning') return issues;
    return issues.map(issue => ({ ...issue, severity: 'warning' as const }));
}

function createBestPracticeIssue(
    rule: BestPracticeRule,
    resourceType: string,
    profileUrl: string | undefined,
): ValidationIssue {
    const issue = createValidationIssue({
        code: rule.code,
        path: rule.path,
        resourceType,
        profile: profileUrl,
        aspectOverride: 'structural',
        severityOverride: 'information',
        customMessage: rule.message,
        details: { bestPractice: true },
    });
    return {
        ...issue,
        tags: rule.tags ?? ['best-practice'],
    };
}

function hasAnyValue(resource: FhirRecord, keys: string[]): boolean {
    return keys.some(key => hasValue(resource[key]));
}

function hasValue(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== '';
}

function hasCodeDisplay(code: FhirRecord): boolean {
    if (isNonEmptyString(code.text)) return true;
    if (!Array.isArray(code.coding)) return false;
    return code.coding.some(candidate => {
        const coding = toRecord(candidate);
        return isNonEmptyString(coding?.display);
    });
}

function hasCodingCode(value: unknown, expectedCode: string): boolean {
    const concept = toRecord(value);
    if (!Array.isArray(concept?.coding)) return false;
    return concept.coding.some(candidate => {
        const coding = toRecord(candidate);
        return coding?.code === expectedCode;
    });
}

function getResourceType(resource: FhirRecord, fallback: string): string {
    if (isNonEmptyString(resource.resourceType)) return resource.resourceType;
    return fallback.length > 0 ? fallback : 'Resource';
}

function toRecord(value: unknown): FhirRecord | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as FhirRecord
        : undefined;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
