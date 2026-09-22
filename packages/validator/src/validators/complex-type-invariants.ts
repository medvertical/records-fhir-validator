import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';

export function checkExtensionExt1(extValue: unknown, basePath: string): ValidationIssue | null {
    const extension = asRecord(extValue);
    if (!extension) return null;

    const hasNestedExtension = Array.isArray(extension.extension) && extension.extension.length > 0;
    const hasValueX = Object.keys(extension).some(k => /^value[A-Z]/.test(k)) ||
        resolveFhirSegmentValue(extension, 'value[x]') !== undefined;

    if (hasNestedExtension !== hasValueX) return null;

    const detail = hasNestedExtension
        ? 'both child extensions AND a value[x]'
        : 'neither child extensions nor a value[x]';
    return createValidationIssue({
        code: 'profile-constraint-violation',
        path: basePath,
        resourceType: typeof extension.resourceType === 'string' ? extension.resourceType : 'Extension',
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

export function checkPeriodPer1(period: unknown, basePath: string): ValidationIssue | null {
    const periodRecord = asRecord(period);
    if (!periodRecord) return null;
    const { start, end } = periodRecord;
    if (typeof start !== 'string' || typeof end !== 'string') return null;
    if (start.length === 0 || end.length === 0) return null;

    const isBackwards = isFhirDateTimeBackwards(start, end);
    if (!isBackwards) return null;

    return createValidationIssue({
        code: 'business-invalid-period-end',
        path: basePath,
        resourceType: typeof periodRecord.resourceType === 'string' ? periodRecord.resourceType : 'Period',
        customMessage: `per-1 violation at ${basePath}: Period.end (${end}) is before Period.start (${start}).`,
        severityOverride: 'error',
        details: { constraintKey: 'per-1', start, end, reason: 'backwards' },
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isFhirDateTimeBackwards(start: string, end: string): boolean {
    const startRange = parseFhirDateTimeRange(start);
    const endRange = parseFhirDateTimeRange(end);
    if (startRange && endRange) {
        return startRange.startMillis > endRange.endMillis;
    }

    return end < start;
}

type DateTimeRange = {
    startMillis: number;
    endMillis: number;
};

function parseFhirDateTimeRange(value: string): DateTimeRange | null {
    const match = value.match(
        /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?)?)?)?$/,
    );
    if (!match) return null;

    const [, yearRaw, monthRaw, dayRaw, hourRaw, , , fractionRaw, offsetRaw] = match;
    const year = Number(yearRaw);

    if (!monthRaw) {
        return utcRange(
            Date.UTC(year, 0, 1, 0, 0, 0, 0),
            Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - 1,
        );
    }

    const month = Number(monthRaw);
    if (!dayRaw) {
        return utcRange(
            Date.UTC(year, month - 1, 1, 0, 0, 0, 0),
            Date.UTC(year, month, 1, 0, 0, 0, 0) - 1,
        );
    }

    const day = Number(dayRaw);
    if (!hourRaw) {
        return utcRange(
            Date.UTC(year, month - 1, day, 0, 0, 0, 0),
            Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - 1,
        );
    }

    if (!offsetRaw) return null;

    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;

    const fractionPrecision = fractionRaw?.length ?? 0;
    const uncertaintyMillis = fractionPrecision > 0 ? Math.max(0, 10 ** (3 - Math.min(3, fractionPrecision)) - 1) : 999;
    return utcRange(millis, millis + uncertaintyMillis);
}

function utcRange(startMillis: number, endMillis: number): DateTimeRange | null {
    if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis)) return null;
    return { startMillis, endMillis };
}
