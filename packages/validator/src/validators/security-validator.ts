import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createSafeValidationFailureMessage } from '../utils/validation-execution-failure.js';
import { detectPHIInNarrative, detectSensitiveIdentifiers } from './security-pii-detector.js';
import { validateAuditTrail, validateSecurityLabels } from './security-policy-checks.js';
import type { SecurityValidationConfig } from './security-validation-types.js';
import { asSecurityRecord, getSecurityResourceType } from './security-validator-utils.js';

export type { PHIDetectionResult, PIILocale, SecurityValidationConfig } from './security-validation-types.js';

const DEFAULT_SECURITY_CONFIG: SecurityValidationConfig = {
    detectPHI: true,
    detectSensitiveIdentifiers: true,
    requireSecurityLabels: false,
    validateAuditTrail: true,
    piiLocale: 'us',
};

export class SecurityValidator {
    private config: SecurityValidationConfig;

    constructor(config?: Partial<SecurityValidationConfig>) {
        this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
    }

    setConfig(config: Partial<SecurityValidationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    validate(resource: unknown): ValidationIssue[] {
        const resourceRecord = asSecurityRecord(resource);
        if (!resourceRecord) return [];
        const resourceType = getSecurityResourceType(resourceRecord);
        const issues: ValidationIssue[] = [];
        logger.debug(`[SecurityValidator] Validating ${resourceType} for security concerns`);

        const narrative = asSecurityRecord(resourceRecord.text);
        if (this.config.detectPHI && typeof narrative?.div === 'string') {
            this.runSubCheck(issues, resourceType, 'phi-detection', () => (
                detectPHIInNarrative(narrative.div as string, resourceType, this.config.piiLocale)
            ));
        }
        if (this.config.detectSensitiveIdentifiers) {
            this.runSubCheck(issues, resourceType, 'sensitive-identifier-detection', () => (
                detectSensitiveIdentifiers(resourceRecord, resourceType, this.config.piiLocale)
            ));
        }
        if (this.config.requireSecurityLabels) {
            this.runSubCheck(issues, resourceType, 'security-label-compliance', () => (
                validateSecurityLabels(resourceRecord, resourceType)
            ));
        }
        if (this.config.validateAuditTrail) {
            this.runSubCheck(issues, resourceType, 'audit-trail', () => (
                validateAuditTrail(resourceRecord, resourceType)
            ));
        }
        if (this.config.customPatterns?.length) {
            this.runSubCheck(issues, resourceType, 'custom-pattern-detection', () => (
                this.detectCustomPatterns(resourceRecord, resourceType)
            ));
        }

        logger.debug(`[SecurityValidator] Found ${issues.length} security concerns`);
        return issues;
    }

    private runSubCheck(
        issues: ValidationIssue[],
        resourceType: string,
        checkName: string,
        run: () => ValidationIssue[],
    ): void {
        try {
            issues.push(...run());
        } catch {
            logger.error('[SecurityValidator] Security sub-check failed', { checkName, resourceType });
            const issue = createValidationIssue({
                code: 'security-validator-error',
                path: resourceType,
                resourceType,
                aspectOverride: 'metadata',
                severityOverride: 'error',
                customMessage: createSafeValidationFailureMessage(`Security sub-check "${checkName}"`),
                details: { checkName },
            });
            issues.push({
                ...issue,
                humanReadable: `The ${checkName} security check did not complete. Treat this resource as security-unverified and investigate the error.`,
                validationMethod: 'security-sub-check',
            });
        }
    }

    private detectCustomPatterns(
        resource: Record<string, unknown>,
        resourceType: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const resourceJson = JSON.stringify(resource);
        for (const custom of this.config.customPatterns || []) {
            try {
                if (!new RegExp(custom.pattern, 'gi').test(resourceJson)) continue;
                issues.push(createValidationIssue({
                    code: `security-custom-${custom.name.toLowerCase().replace(/\s+/g, '-')}`,
                    path: resourceType,
                    resourceType,
                    customMessage: `Custom pattern detected: ${custom.name}`,
                    severityOverride: custom.severity,
                }));
            } catch {
                logger.warn('[SecurityValidator] Invalid custom security pattern');
                issues.push(createValidationIssue({
                    code: 'security-custom-pattern-invalid',
                    path: resourceType,
                    resourceType,
                    aspectOverride: 'metadata',
                    customMessage: `Custom security pattern "${custom.name}" is invalid and was not evaluated`,
                    severityOverride: 'error',
                    details: { patternName: custom.name },
                }));
            }
        }
        return issues;
    }
}
