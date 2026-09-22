import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { asSecurityRecord } from './security-validator-utils.js';

export function validateSecurityLabels(
    resource: Record<string, unknown>,
    resourceType: string,
): ValidationIssue[] {
    const security = Array.isArray(asSecurityRecord(resource.meta)?.security)
        ? asSecurityRecord(resource.meta)?.security as unknown[]
        : [];
    if (security.length === 0) {
        return [createValidationIssue({
            code: 'security-missing-labels',
            path: `${resourceType}.meta.security`,
            resourceType,
            customMessage: 'Resource is missing security labels (required by policy)',
            severityOverride: 'warning',
        })];
    }

    const hasConfidentiality = security.some(
        label => asSecurityRecord(label)?.system === 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
    );
    return hasConfidentiality ? [] : [createValidationIssue({
        code: 'security-missing-confidentiality',
        path: `${resourceType}.meta.security`,
        resourceType,
        customMessage: 'Resource is missing confidentiality classification',
        severityOverride: 'info',
    })];
}

export function validateAuditTrail(
    resource: Record<string, unknown>,
    resourceType: string,
): ValidationIssue[] {
    const meta = asSecurityRecord(resource.meta);
    const issues: ValidationIssue[] = [];
    if (typeof meta?.source !== 'string' || meta.source.length === 0) {
        issues.push(createValidationIssue({
            code: 'security-audit-missing-source',
            path: `${resourceType}.meta.source`,
            resourceType,
            customMessage: 'Resource is missing meta.source for audit trail',
            severityOverride: 'info',
        }));
    }
    if (typeof meta?.lastUpdated !== 'string' || meta.lastUpdated.length === 0) {
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
