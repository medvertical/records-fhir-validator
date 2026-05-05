/**
 * Security Validator
 * 
 * Validates FHIR resources for security and compliance concerns:
 * - PHI (Protected Health Information) detection in narrative/text fields
 * - Sensitive identifier patterns (SSN, MRN, credit cards)
 * - Security label requirements
 * - Audit trail metadata validation
 * 
 * Produces INFO/WARNING severity issues to alert developers about potential privacy concerns.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export type PIILocale = 'us' | 'de' | 'all';

export interface SecurityValidationConfig {
    /** Enable PHI pattern detection */
    detectPHI: boolean;
    /** Enable sensitive identifier detection */
    detectSensitiveIdentifiers: boolean;
    /** Check security label requirements */
    requireSecurityLabels: boolean;
    /** Check audit trail metadata */
    validateAuditTrail: boolean;
    /** PII pattern locale: 'us' (default), 'de' (German), 'all' (both) */
    piiLocale: PIILocale;
    /** Custom patterns to detect (regex strings) */
    customPatterns?: { pattern: string; name: string; severity: 'warning' | 'info' }[];
}

export interface PHIDetectionResult {
    found: boolean;
    type: string;
    path: string;
    preview?: string;
}

// ============================================================================
// Sensitive Data Patterns
// ============================================================================

/** US Social Security Number patterns */
const SSN_PATTERNS = [
    /\b\d{3}-\d{2}-\d{4}\b/,           // 123-45-6789
    /\b\d{3}\s\d{2}\s\d{4}\b/,         // 123 45 6789
    /\bSSN[:\s]*\d{9}\b/i,             // SSN: 123456789
];

/** Medical Record Number patterns (reserved for future detection use) */
const _MRN_PATTERNS = [
    /\bMRN[:\s#]*\d{6,12}\b/i,         // MRN: 123456
    /\bMedical\s*Record[:\s#]*\d+/i,   // Medical Record: 123456
];

/** Credit Card patterns */
const CREDIT_CARD_PATTERNS = [
    /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,  // Visa
    /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Mastercard
    /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/,         // Amex
];

/** Phone number patterns (potential PHI in context) */
const PHONE_PATTERNS = [
    /\b\(\d{3}\)\s?\d{3}-\d{4}\b/,     // (123) 456-7890
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, // 123-456-7890
];

/** Email patterns */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;

/** Date of birth patterns (potential PHI) */
const DOB_PATTERNS = [
    /\b(DOB|Date\s*of\s*Birth|Born)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
    /\bBirthdate[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
];

/** Address patterns (potential PHI in narrative) */
const ADDRESS_KEYWORDS = [
    /\b\d+\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct)\b/i,
];

// ============================================================================
// German (DE) Sensitive Data Patterns
// ============================================================================

/** German health insurance number (Krankenversichertennummer / KVNR): letter + 9 digits */
const KVNR_PATTERNS = [
    /\b[A-Z]\d{9}\b/,                          // A123456789
    /\bKVNR[:\s]*[A-Z]\d{9}\b/i,              // KVNR: A123456789
    /\bVersichertennummer[:\s]*[A-Z]\d{9}\b/i, // Versichertennummer: A123456789
];

/** German tax identification number (Steuerliche Identifikationsnummer): 11 digits */
const STEUER_ID_PATTERNS = [
    /\bSteuer[-\s]?ID[:\s]*\d{11}\b/i,         // Steuer-ID: 12345678901
    /\bIdNr[:\s]*\d{11}\b/i,                    // IdNr: 12345678901
    /\bIdentifikationsnummer[:\s]*\d{11}\b/i,   // Identifikationsnummer: 12345678901
];

/** German institutional identifier (Institutionskennzeichen / IKNR): 9 digits */
const IKNR_PATTERNS = [
    /\bIKNR[:\s]*\d{9}\b/i,                     // IKNR: 123456789
    /\bIK[:\s]*\d{9}\b/i,                       // IK: 123456789
    /\bInstitutionskennzeichen[:\s]*\d{9}\b/i,  // Institutionskennzeichen: 123456789
];

/** IBAN patterns (DE focus but matches any) */
const IBAN_PATTERNS = [
    /\bDE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/,  // DE89 3704 0044 0532 0130 00
    /\bIBAN[:\s]*[A-Z]{2}\d{2}\s?[\d\s]{10,30}\b/i,           // IBAN: DE89...
];

/** German phone number patterns */
const DE_PHONE_PATTERNS = [
    /(?:^|[\s(])(\+49\s?\(?\d{2,4}\)?\s?[\d\s/-]{6,12})\b/,  // +49 30 1234567
    /\b0\d{2,4}[\s/-]\d{3,8}[\s/-]?\d{0,5}\b/,               // 030/12345678, 0171-1234567
];

/** German address patterns */
const DE_ADDRESS_KEYWORDS = [
    /\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|str\.|weg|gasse|platz|allee|ring|damm)\s+\d+/i,  // Hauptstraße 42
];

// ============================================================================
// Security Validator Class
// ============================================================================

export class SecurityValidator {
    private config: SecurityValidationConfig;

    constructor(config?: Partial<SecurityValidationConfig>) {
        this.config = {
            detectPHI: true,
            detectSensitiveIdentifiers: true,
            requireSecurityLabels: false,
            validateAuditTrail: true,
            piiLocale: 'us',
            ...config
        };
    }

    /**
     * Configure security validation
     */
    setConfig(config: Partial<SecurityValidationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Validate a resource for security concerns.
     *
     * Each sub-check (PHI detection, sensitive identifiers, security labels,
     * audit trail, custom patterns) is wrapped in its own try/catch so a
     * single failing check does not silently mask the other checks. Any
     * failure is promoted to a `security-validator-error` issue so the caller
     * knows a check was skipped — the previous behaviour only logged the
     * error, which could hide real PHI-detection failures from reviewers.
     */
    validate(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceType = resource?.resourceType || 'Unknown';

        logger.debug(`[SecurityValidator] Validating ${resourceType} for security concerns`);

        // 1. PHI Detection in Narrative
        if (this.config.detectPHI && resource?.text?.div) {
            this.runSubCheck(
                issues,
                resourceType,
                'phi-detection',
                () => this.detectPHIInNarrative(resource.text.div, resourceType),
            );
        }

        // 2. Sensitive Identifier Detection
        if (this.config.detectSensitiveIdentifiers) {
            this.runSubCheck(
                issues,
                resourceType,
                'sensitive-identifier-detection',
                () => this.detectSensitiveIdentifiers(resource, resourceType),
            );
        }

        // 3. Security Label Compliance
        if (this.config.requireSecurityLabels) {
            this.runSubCheck(
                issues,
                resourceType,
                'security-label-compliance',
                () => this.validateSecurityLabels(resource, resourceType),
            );
        }

        // 4. Audit Trail Validation
        if (this.config.validateAuditTrail) {
            this.runSubCheck(
                issues,
                resourceType,
                'audit-trail',
                () => this.validateAuditTrail(resource, resourceType),
            );
        }

        // 5. Custom Pattern Detection
        if (this.config.customPatterns && this.config.customPatterns.length > 0) {
            this.runSubCheck(
                issues,
                resourceType,
                'custom-pattern-detection',
                () => this.detectCustomPatterns(resource, resourceType),
            );
        }

        logger.debug(`[SecurityValidator] Found ${issues.length} security concerns`);
        return issues;
    }

    /**
     * Run one security sub-check and promote any thrown error to a
     * `security-validator-error` issue. The error is **not** swallowed — it
     * becomes visible in the validation result so reviewers know a check
     * was skipped.
     */
    private runSubCheck(
        issues: ValidationIssue[],
        resourceType: string,
        checkName: string,
        run: () => ValidationIssue[],
    ): void {
        try {
            issues.push(...run());
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(
                `[SecurityValidator] ${checkName} failed on ${resourceType}: ${message}`,
            );
            issues.push({
                id: `security-validator-error-${checkName}-${Date.now()}`,
                aspect: 'metadata',
                severity: 'error',
                code: 'security-validator-error',
                message: `Security sub-check "${checkName}" failed: ${message}`,
                path: '',
                humanReadable:
                    `The ${checkName} security check did not complete. ` +
                    `Treat this resource as security-unverified and investigate the error.`,
                details: {
                    validationType: 'security-sub-check-error',
                    checkName,
                    resourceType,
                    error: message,
                },
                validationMethod: 'security-sub-check',
                timestamp: new Date().toISOString(),
                resourceType,
                schemaVersion: 'R4',
            } as ValidationIssue);
        }
    }

    // ==========================================================================
    // Locale helpers
    // ==========================================================================

    private get checkUS(): boolean {
        return this.config.piiLocale === 'us' || this.config.piiLocale === 'all';
    }

    private get checkDE(): boolean {
        return this.config.piiLocale === 'de' || this.config.piiLocale === 'all';
    }

    // ==========================================================================
    // PHI Detection
    // ==========================================================================

    /** Test `patterns` against `text`; push an issue on first match. */
    private matchAny(
        issues: ValidationIssue[], text: string, patterns: RegExp[],
        code: string, path: string, resourceType: string,
        message: string, severity: 'warning' | 'info',
    ): void {
        if (patterns.some(p => p.test(text))) {
            issues.push(createValidationIssue({ code, path, resourceType, customMessage: message, severityOverride: severity }));
        }
    }

    private detectPHIInNarrative(narrativeHtml: string, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const plainText = narrativeHtml.replace(/<[^>]+>/g, ' ');
        const divPath = `${resourceType}.text.div`;

        if (this.checkUS) {
            this.matchAny(issues, plainText, SSN_PATTERNS, 'security-phi-ssn-detected', divPath, resourceType, 'Potential SSN detected in narrative text', 'warning');
            this.matchAny(issues, plainText, PHONE_PATTERNS, 'security-phi-phone-in-narrative', divPath, resourceType, 'Phone number detected in narrative (consider if necessary)', 'info');
            this.matchAny(issues, plainText, ADDRESS_KEYWORDS, 'security-phi-address-in-narrative', divPath, resourceType, 'Street address pattern detected in narrative', 'info');
        }
        if (this.checkDE) {
            this.matchAny(issues, plainText, KVNR_PATTERNS, 'security-phi-kvnr-detected', divPath, resourceType, 'Potential KVNR (Krankenversichertennummer) detected in narrative text', 'warning');
            this.matchAny(issues, plainText, STEUER_ID_PATTERNS, 'security-phi-steuerid-detected', divPath, resourceType, 'Potential Steuer-ID (tax identification number) detected in narrative text', 'warning');
            this.matchAny(issues, plainText, DE_PHONE_PATTERNS, 'security-phi-de-phone-in-narrative', divPath, resourceType, 'German phone number detected in narrative', 'info');
            this.matchAny(issues, plainText, DE_ADDRESS_KEYWORDS, 'security-phi-de-address-in-narrative', divPath, resourceType, 'German street address pattern detected in narrative', 'info');
            this.matchAny(issues, plainText, IBAN_PATTERNS, 'security-phi-iban-in-narrative', divPath, resourceType, 'IBAN detected in narrative text', 'warning');
        }
        this.matchAny(issues, plainText, [EMAIL_PATTERN], 'security-phi-email-in-narrative', divPath, resourceType, 'Email address detected in narrative (consider if necessary)', 'info');
        this.matchAny(issues, plainText, DOB_PATTERNS, 'security-phi-dob-in-narrative', divPath, resourceType, 'Date of birth reference detected in narrative', 'info');

        return issues;
    }

    // ==========================================================================
    // Sensitive Identifier Detection
    // ==========================================================================

    /**
     * Detect sensitive identifiers in resource
     */
    private detectSensitiveIdentifiers(resource: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        if (!resource.identifier || !Array.isArray(resource.identifier)) return issues;

        for (let i = 0; i < resource.identifier.length; i++) {
            const value = resource.identifier[i]?.value;
            if (!value || typeof value !== 'string') continue;
            const idPath = `${resourceType}.identifier[${i}].value`;

            if (this.checkUS) {
                this.matchAny(issues, value, SSN_PATTERNS, 'security-sensitive-ssn-identifier', idPath, resourceType, 'SSN pattern detected in identifier value', 'warning');
                this.matchAny(issues, value, CREDIT_CARD_PATTERNS, 'security-sensitive-cc-identifier', idPath, resourceType, 'Credit card pattern detected in identifier (inappropriate for FHIR)', 'warning');
            }
            if (this.checkDE) {
                this.matchAny(issues, value, KVNR_PATTERNS, 'security-sensitive-kvnr-identifier', idPath, resourceType, 'KVNR (Krankenversichertennummer) pattern detected in identifier value', 'warning');
                this.matchAny(issues, value, STEUER_ID_PATTERNS, 'security-sensitive-steuerid-identifier', idPath, resourceType, 'Steuer-ID (tax identification number) detected in identifier value', 'warning');
                this.matchAny(issues, value, IKNR_PATTERNS, 'security-sensitive-iknr-identifier', idPath, resourceType, 'IKNR (Institutionskennzeichen) detected in identifier value', 'warning');
                this.matchAny(issues, value, IBAN_PATTERNS, 'security-sensitive-iban-identifier', idPath, resourceType, 'IBAN detected in identifier value', 'warning');
            }
        }
        return issues;
    }

    // ==========================================================================
    // Security Label Compliance
    // ==========================================================================

    /**
     * Validate security labels on resource
     */
    private validateSecurityLabels(resource: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check if meta.security exists
        if (!resource.meta?.security || resource.meta.security.length === 0) {
            issues.push(createValidationIssue({
                code: 'security-missing-labels',
                path: `${resourceType}.meta.security`,
                resourceType,
                customMessage: 'Resource is missing security labels (required by policy)',
                severityOverride: 'warning',
            }));
            return issues;
        }

        // Check for confidentiality code
        const hasConfidentiality = resource.meta.security.some(
            (s: any) => s.system === 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality'
        );

        if (!hasConfidentiality) {
            issues.push(createValidationIssue({
                code: 'security-missing-confidentiality',
                path: `${resourceType}.meta.security`,
                resourceType,
                customMessage: 'Resource is missing confidentiality classification',
                severityOverride: 'info',
            }));
        }

        return issues;
    }

    // ==========================================================================
    // Audit Trail Validation
    // ==========================================================================

    /**
     * Validate audit trail metadata
     */
    private validateAuditTrail(resource: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check for meta.source (provenance tracking)
        if (!resource.meta?.source) {
            issues.push(createValidationIssue({
                code: 'security-audit-missing-source',
                path: `${resourceType}.meta.source`,
                resourceType,
                customMessage: 'Resource is missing meta.source for audit trail',
                severityOverride: 'info',
            }));
        }

        // Check for meta.lastUpdated
        if (!resource.meta?.lastUpdated) {
            issues.push(createValidationIssue({
                code: 'security-audit-missing-lastupdated',
                path: `${resourceType}.meta.lastUpdated`,
                resourceType,
                customMessage: 'Resource is missing meta.lastUpdated timestamp',
                severityOverride: 'info',
            }));
        }

        return issues;
    }

    // ==========================================================================
    // Custom Pattern Detection
    // ==========================================================================

    /**
     * Detect custom patterns in resource
     */
    private detectCustomPatterns(resource: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceJson = JSON.stringify(resource);

        for (const custom of this.config.customPatterns || []) {
            try {
                const regex = new RegExp(custom.pattern, 'gi');
                if (regex.test(resourceJson)) {
                    issues.push(createValidationIssue({
                        code: `security-custom-${custom.name.toLowerCase().replace(/\s+/g, '-')}`,
                        path: resourceType,
                        resourceType,
                        customMessage: `Custom pattern detected: ${custom.name}`,
                        severityOverride: custom.severity,
                    }));
                }
            } catch {
                logger.warn(`[SecurityValidator] Invalid custom pattern: ${custom.pattern}`);
            }
        }

        return issues;
    }
}

// Singleton instance
export const securityValidator = new SecurityValidator();
