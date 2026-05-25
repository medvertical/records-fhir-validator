import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export function checkExtensionExt1(extValue: any, basePath: string): ValidationIssue | null {
    if (!extValue || typeof extValue !== 'object') return null;

    const hasNestedExtension = Array.isArray(extValue.extension) && extValue.extension.length > 0;
    const hasValueX = Object.keys(extValue).some(k => /^value[A-Z]/.test(k));

    if (hasNestedExtension !== hasValueX) return null;

    const detail = hasNestedExtension
        ? 'both child extensions AND a value[x]'
        : 'neither child extensions nor a value[x]';
    return createValidationIssue({
        code: 'profile-constraint-violation',
        path: basePath,
        resourceType: extValue.resourceType || 'Extension',
        customMessage:
            `ext-1 violation at ${basePath}: Extension must have either ` +
            `extensions or value[x], not both. Found ${detail}.`,
        severityOverride: 'error',
        details: {
            constraintKey: 'ext-1',
            hasNestedExtension,
            hasValueX,
        },
    });
}

export function checkPeriodPer1(period: any, basePath: string): ValidationIssue | null {
    if (!period || typeof period !== 'object') return null;
    const { start, end } = period;
    if (typeof start !== 'string' || typeof end !== 'string') return null;
    if (start.length === 0 || end.length === 0) return null;

    const precisionMismatch = !start.includes('T') !== !end.includes('T');
    const isBackwards = precisionMismatch || isFhirDateTimeBackwards(start, end);
    if (!isBackwards) return null;

    const reason = precisionMismatch ? 'precision-mismatch' : 'backwards';
    const message = precisionMismatch
        ? `per-1 violation at ${basePath}: Period.start (${start}) and Period.end (${end}) ` +
        `have different precision — comparison is indeterminate.`
        : `per-1 violation at ${basePath}: Period.end (${end}) is before Period.start (${start}).`;

    return createValidationIssue({
        code: 'business-invalid-period-end',
        path: basePath,
        resourceType: period.resourceType || 'Period',
        customMessage: message,
        severityOverride: 'error',
        details: { constraintKey: 'per-1', start, end, reason },
    });
}

function isFhirDateTimeBackwards(start: string, end: string): boolean {
    const bothDateTime = start.includes('T') && end.includes('T');
    if (!bothDateTime) return end < start;

    const startMillis = Date.parse(start);
    const endMillis = Date.parse(end);
    if (Number.isFinite(startMillis) && Number.isFinite(endMillis)) {
        return endMillis < startMillis;
    }

    return end < start;
}
