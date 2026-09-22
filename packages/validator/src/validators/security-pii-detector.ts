import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { PIILocale } from './security-validation-types.js';
import { asSecurityRecord } from './security-validator-utils.js';

const US_NARRATIVE_PATTERNS: DetectionRule[] = [
    rule('security-phi-ssn-detected', 'Potential SSN detected in narrative text', 'warning', [
        /\b\d{3}-\d{2}-\d{4}\b/,
        /\b\d{3}\s\d{2}\s\d{4}\b/,
        /\bSSN[:\s]*\d{9}\b/i,
    ]),
    rule('security-phi-phone-in-narrative', 'Phone number detected in narrative (consider if necessary)', 'info', [
        /\b\(\d{3}\)\s?\d{3}-\d{4}\b/,
        /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
    ]),
    rule('security-phi-address-in-narrative', 'Street address pattern detected in narrative', 'info', [
        /\b\d+\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct)\b/i,
    ]),
];

const DE_NARRATIVE_PATTERNS: DetectionRule[] = [
    rule('security-phi-kvnr-detected', 'Potential KVNR (Krankenversichertennummer) detected in narrative text', 'warning', kvnrPatterns()),
    rule('security-phi-steuerid-detected', 'Potential Steuer-ID (tax identification number) detected in narrative text', 'warning', steuerIdPatterns()),
    rule('security-phi-de-phone-in-narrative', 'German phone number detected in narrative', 'info', [
        /(?:^|[\s(])(\+49\s?\(?\d{2,4}\)?\s?[\d\s/-]{6,12})\b/,
        /\b0\d{2,4}[\s/-]\d{3,8}[\s/-]?\d{0,5}\b/,
    ]),
    rule('security-phi-de-address-in-narrative', 'German street address pattern detected in narrative', 'info', [
        /\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|str\.|weg|gasse|platz|allee|ring|damm)\s+\d+/i,
    ]),
    rule('security-phi-iban-in-narrative', 'IBAN detected in narrative text', 'warning', ibanPatterns()),
];

const UNIVERSAL_NARRATIVE_PATTERNS: DetectionRule[] = [
    rule('security-phi-email-in-narrative', 'Email address detected in narrative (consider if necessary)', 'info', [
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    ]),
    rule('security-phi-dob-in-narrative', 'Date of birth reference detected in narrative', 'info', [
        /\b(DOB|Date\s*of\s*Birth|Born)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
        /\bBirthdate[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
    ]),
];

const US_IDENTIFIER_PATTERNS: DetectionRule[] = [
    rule('security-sensitive-ssn-identifier', 'SSN pattern detected in identifier value', 'warning', US_NARRATIVE_PATTERNS[0].patterns),
    rule('security-sensitive-cc-identifier', 'Credit card pattern detected in identifier (inappropriate for FHIR)', 'warning', [
        /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
        /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
        /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/,
    ]),
];

const DE_IDENTIFIER_PATTERNS: DetectionRule[] = [
    rule('security-sensitive-kvnr-identifier', 'KVNR (Krankenversichertennummer) pattern detected in identifier value', 'warning', kvnrPatterns()),
    rule('security-sensitive-steuerid-identifier', 'Steuer-ID (tax identification number) detected in identifier value', 'warning', steuerIdPatterns()),
    rule('security-sensitive-iknr-identifier', 'IKNR (Institutionskennzeichen) detected in identifier value', 'warning', [
        /\bIKNR[:\s]*\d{9}\b/i,
        /\bIK[:\s]*\d{9}\b/i,
        /\bInstitutionskennzeichen[:\s]*\d{9}\b/i,
    ]),
    rule('security-sensitive-iban-identifier', 'IBAN detected in identifier value', 'warning', ibanPatterns()),
];

interface DetectionRule {
    code: string;
    message: string;
    severity: 'warning' | 'info';
    patterns: RegExp[];
}

export function detectPHIInNarrative(
    narrativeHtml: string,
    resourceType: string,
    locale: PIILocale,
): ValidationIssue[] {
    const plainText = narrativeHtml.replace(/<[^>]+>/g, ' ');
    const rules = [
        ...(checksUS(locale) ? US_NARRATIVE_PATTERNS : []),
        ...(checksDE(locale) ? DE_NARRATIVE_PATTERNS : []),
        ...UNIVERSAL_NARRATIVE_PATTERNS,
    ];
    return detectRules(plainText, `${resourceType}.text.div`, resourceType, rules);
}

export function detectSensitiveIdentifiers(
    resource: Record<string, unknown>,
    resourceType: string,
    locale: PIILocale,
): ValidationIssue[] {
    if (!Array.isArray(resource.identifier)) return [];
    const rules = [
        ...(checksUS(locale) ? US_IDENTIFIER_PATTERNS : []),
        ...(checksDE(locale) ? DE_IDENTIFIER_PATTERNS : []),
    ];
    return resource.identifier.flatMap((candidate, index) => {
        const value = asSecurityRecord(candidate)?.value;
        return typeof value === 'string' && value.length > 0
            ? detectRules(value, `${resourceType}.identifier[${index}].value`, resourceType, rules)
            : [];
    });
}

function detectRules(
    text: string,
    path: string,
    resourceType: string,
    rules: DetectionRule[],
): ValidationIssue[] {
    return rules
        .filter(candidate => candidate.patterns.some(pattern => pattern.test(text)))
        .map(candidate => createValidationIssue({
            code: candidate.code,
            path,
            resourceType,
            customMessage: candidate.message,
            severityOverride: candidate.severity,
        }));
}

function rule(
    code: string,
    message: string,
    severity: DetectionRule['severity'],
    patterns: RegExp[],
): DetectionRule {
    return { code, message, severity, patterns };
}

function kvnrPatterns(): RegExp[] {
    return [/\b[A-Z]\d{9}\b/, /\bKVNR[:\s]*[A-Z]\d{9}\b/i, /\bVersichertennummer[:\s]*[A-Z]\d{9}\b/i];
}

function steuerIdPatterns(): RegExp[] {
    return [/\bSteuer[-\s]?ID[:\s]*\d{11}\b/i, /\bIdNr[:\s]*\d{11}\b/i, /\bIdentifikationsnummer[:\s]*\d{11}\b/i];
}

function ibanPatterns(): RegExp[] {
    return [/\bDE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/, /\bIBAN[:\s]*[A-Z]{2}\d{2}\s?[\d\s]{10,30}\b/i];
}

function checksUS(locale: PIILocale): boolean {
    return locale === 'us' || locale === 'all';
}

function checksDE(locale: PIILocale): boolean {
    return locale === 'de' || locale === 'all';
}
