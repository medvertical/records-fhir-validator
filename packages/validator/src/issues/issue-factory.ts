/**
 * Factory helpers for standardized ValidationIssue creation.
 */

import {
    computeValidationIssueId,
    type ValidationIssue,
    type ValidationAspect,
    type ValidationSeverity,
    type ValidationIssueTarget,
} from '@records-fhir/validation-types';
import { ValidationCodes as _ValidationCodes, getCodeMetadata, resolveCode, type ValidationCode } from './message-catalog.js';
import { formatMessage, getHumanReadableMessage } from './message-formatting.js';
import { normalizeResourceType } from './resource-type-normalizer.js';
import { buildBindingViolationDetails } from './binding-violation-details.js';

export interface CreateIssueParams {
    code: ValidationCode | string;
    path: string;
    resourceType: string;
    messageParams?: Record<string, unknown>;
    customMessage?: string;
    profile?: string;
    details?: Record<string, unknown>;
    severityOverride?: ValidationSeverity;
    aspectOverride?: ValidationAspect;
    ruleId?: string;
    target?: Partial<ValidationIssueTarget>;
}

const UNSAFE_DETAIL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function copySafeDetails(
    target: Record<string, unknown>,
    source: Record<string, unknown> | undefined,
): void {
    if (!source) return;
    for (const [key, value] of Object.entries(source)) {
        if (!UNSAFE_DETAIL_KEYS.has(key)) target[key] = value;
    }
}

function generateIssueId(params: {
    aspect: string;
    severity: ValidationSeverity;
    code: string;
    path: string;
    resourceType: string;
    message: string;
    profile?: string;
    ruleId?: string;
    details: Record<string, unknown>;
}): string {
    return computeValidationIssueId(params);
}

/**
 * Kept for backward-compatible tests/callers. Issue IDs are now deterministic
 * and no longer rely on mutable counters.
 */
export function resetIssueCounter(): void {
}

export function createValidationIssue(params: CreateIssueParams): ValidationIssue {
    const {
        code,
        path,
        resourceType: rawResourceType,
        messageParams = {},
        customMessage,
        profile,
        details,
        severityOverride,
        aspectOverride,
        ruleId,
        target,
    } = params;
    const resourceType = normalizeResourceType(rawResourceType, path);

    const resolvedCode = resolveCode(code);
    const metadata = getCodeMetadata(code);

    const aspect: ValidationAspect = aspectOverride || metadata?.aspect || 'structural';
    const severity: ValidationSeverity = severityOverride || metadata?.severity || 'warning';

    const message = customMessage || formatMessage(resolvedCode, messageParams);
    const humanReadable = getHumanReadableMessage(resolvedCode, messageParams);

    const issueDetails: Record<string, unknown> = {};
    copySafeDetails(issueDetails, details);
    issueDetails.fieldPath = path;
    issueDetails.resourceType = resourceType;
    issueDetails.validationType = `${aspect}-validation`;

    for (const [key, value] of Object.entries(messageParams)) {
        if (
            !UNSAFE_DETAIL_KEYS.has(key)
            && !Object.prototype.hasOwnProperty.call(issueDetails, key)
        ) {
            issueDetails[key] = value;
        }
    }
    if (target?.elementId && !('elementId' in issueDetails)) {
        issueDetails.elementId = target.elementId;
    }
    if (target?.extensionUrl && !('extensionUrl' in issueDetails)) {
        issueDetails.extensionUrl = target.extensionUrl;
    }
    if (target?.sliceName && !('sliceName' in issueDetails)) {
        issueDetails.sliceName = target.sliceName;
    }
    const detailString = (key: string): string | undefined =>
        typeof issueDetails[key] === 'string'
            ? issueDetails[key] as string
            : undefined;
    const issueTarget: ValidationIssueTarget = {
        path: target?.path ?? path,
        elementId: target?.elementId ?? detailString('elementId') ?? path,
        extensionUrl:
            target?.extensionUrl
            ?? detailString('extensionUrl')
            ?? detailString('url'),
        sliceName:
            target?.sliceName
            ?? detailString('sliceName')
            ?? detailString('slice'),
    };

    return {
        id: generateIssueId({
            aspect,
            severity,
            code: resolvedCode,
            path,
            resourceType,
            message,
            profile,
            ruleId,
            details: issueDetails,
        }),
        aspect,
        severity,
        code: resolvedCode,
        message,
        humanReadable,
        path,
        details: issueDetails,
        validationMethod: `${aspect}-validation`,
        timestamp: new Date().toISOString(),
        resourceType,
        schemaVersion: 'R4',
        profile,
        ruleId,
        target: issueTarget,
    };
}

/**
 * Create a terminology binding violation issue.
 * Uses different message templates for primitive codes (no system) vs Coding types (with system).
 */
export function createBindingViolation(params: {
    strength: 'required' | 'extensible' | 'preferred' | 'example';
    code: string;
    system?: string;
    valueSet: string;
    path: string;
    resourceType: string;
    profile?: string;
}): ValidationIssue {
    const hasSystem = params.system !== undefined && params.system !== '';

    const codeMap = hasSystem ? {
        required: 'terminology-binding-required',
        extensible: 'terminology-binding-extensible',
        preferred: 'terminology-binding-preferred',
        example: 'terminology-binding-example',
    } as const : {
        required: 'terminology-binding-required-code',
        extensible: 'terminology-binding-extensible-code',
        preferred: 'terminology-binding-preferred-code',
        example: 'terminology-binding-example-code',
    } as const;

    return createValidationIssue({
        code: codeMap[params.strength],
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        details: buildBindingViolationDetails(params.system, params.valueSet),
        messageParams: hasSystem ? {
            code: params.code,
            system: params.system,
            valueSet: params.valueSet,
        } : {
            code: params.code,
            valueSet: params.valueSet,
        },
    });
}

export function createRequiredElementMissing(params: {
    element: string;
    path: string;
    resourceType: string;
    profile?: string;
}): ValidationIssue {
    return createValidationIssue({
        code: 'structural-required-element-missing',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        messageParams: {
            element: params.element,
        },
    });
}

export function createReferenceTypeMismatch(params: {
    actual: string;
    allowed: string[];
    path: string;
    resourceType: string;
}): ValidationIssue {
    return createValidationIssue({
        code: 'reference-type-mismatch',
        path: params.path,
        resourceType: params.resourceType,
        messageParams: {
            actual: params.actual,
            allowed: params.allowed.join(', '),
        },
    });
}

export function createConstraintViolation(params: {
    key: string;
    message: string;
    path: string;
    resourceType: string;
    profile?: string;
    severity?: ValidationSeverity;
}): ValidationIssue {
    return createValidationIssue({
        code: 'profile-constraint-violation',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        severityOverride: params.severity,
        messageParams: {
            key: params.key,
            message: params.message,
        },
    });
}

export function createValidationError(params: {
    message: string;
    path: string;
    resourceType: string;
    aspect?: ValidationAspect;
}): ValidationIssue {
    return createValidationIssue({
        code: 'validation-error',
        path: params.path,
        resourceType: params.resourceType,
        aspectOverride: params.aspect,
        customMessage: params.message,
    });
}
