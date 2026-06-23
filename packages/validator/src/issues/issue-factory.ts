/**
 * Validation Issue Factory
 *
 * Factory function to standardize the creation of ValidationIssue objects.
 * Replaces inline object literals across validators with a single,
 * consistent creation pattern.
 *
 * Benefits:
 * - Consistent field population (id, timestamp, schemaVersion)
 * - Automatic code resolution via aliases
 * - Template-based message formatting
 * - Type safety for code values
 */

import {
    computeValidationIssueId,
    type ValidationIssue,
    type ValidationAspect,
    type ValidationSeverity,
} from '@records-fhir/validation-types';
import { ValidationCodes as _ValidationCodes, getCodeMetadata, resolveCode, type ValidationCode } from './message-catalog';
import { formatMessage, getHumanReadableMessage } from './message-templates';
import { normalizeResourceType } from './resource-type-normalizer';

// ============================================================================
// Factory Parameters
// ============================================================================

export interface CreateIssueParams {
    /**
     * The validation code. Can be a canonical code or a legacy alias.
     */
    code: ValidationCode | string;

    /**
     * FHIRPath to the element with the issue.
     */
    path: string;

    /**
     * Resource type being validated.
     */
    resourceType: string;

    /**
     * Parameters for message template interpolation.
     * These will be substituted into the message template.
     */
    messageParams?: Record<string, unknown>;

    /**
     * Optional custom message to override the template.
     */
    customMessage?: string;

    /**
     * Profile URL if this issue is related to profile validation.
     */
    profile?: string;

    /**
     * Additional details to include in the issue.
     */
    details?: Record<string, unknown>;

    /**
     * Override the default severity for this code.
     */
    severityOverride?: ValidationSeverity;

    /**
     * Override the default aspect for this code.
     */
    aspectOverride?: ValidationAspect;

    /**
     * Rule identifier for signature grouping (e.g., constraint key like 'ext-1', 'enc-1').
     * This is used to distinguish between different rules that share the same code.
     */
    ruleId?: string;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a deterministic issue ID from the issue identity fields.
 */
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

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a standardized ValidationIssue object.
 *
 * @example
 * ```typescript
 * const issue = createValidationIssue({
 *   code: 'terminology-binding-required',
 *   path: 'Patient.gender',
 *   resourceType: 'Patient',
 *   messageParams: {
 *     code: 'invalid-code',
 *     system: 'http://example.org',
 *     valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
 *   },
 * });
 * ```
 */
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
    } = params;
    const resourceType = normalizeResourceType(rawResourceType, path);

    // Resolve any aliases to canonical codes
    const resolvedCode = resolveCode(code);
    const metadata = getCodeMetadata(code);

    // Determine aspect and severity (with overrides)
    const aspect: ValidationAspect = aspectOverride || metadata?.aspect || 'structural';
    const severity: ValidationSeverity = severityOverride || metadata?.severity || 'warning';

    // Generate message
    const message = customMessage || formatMessage(resolvedCode, messageParams);
    const humanReadable = getHumanReadableMessage(resolvedCode, messageParams);

    // Build details object
    const issueDetails: Record<string, unknown> = {
        ...details,
        fieldPath: path,
        resourceType,
        validationType: `${aspect}-validation`,
    };

    // Add message params to details for potential hydration
    for (const [key, value] of Object.entries(messageParams)) {
        if (!(key in issueDetails)) {
            issueDetails[key] = value;
        }
    }

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
    };
}

// ============================================================================
// Convenience Factories
// ============================================================================

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
    // Detect if this is a primitive code type (no system) or a Coding type (with system)
    const hasSystem = params.system !== undefined && params.system !== '';

    // Use -code variants for primitive code types (without system)
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

/**
 * Create a "binding could not be verified" informational issue.
 *
 * Emitted when a coded element's ValueSet cannot be expanded locally and no
 * terminology server confirmed the code. Distinct from a binding violation:
 * the code is not known to be wrong, only unverifiable. Severity is
 * informational so it never gates, but the skip becomes visible instead of
 * silent (gap P-3).
 */
export function createBindingUnverified(params: {
    strength: 'required' | 'extensible' | 'preferred';
    code: string;
    system?: string;
    valueSet: string;
    path: string;
    resourceType: string;
    profile?: string;
    /** Override the default `information` severity (e.g. `warning` under a strict policy). */
    severityOverride?: ValidationSeverity;
}): ValidationIssue {
    return createValidationIssue({
        code: 'terminology-binding-unverified',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        severityOverride: params.severityOverride,
        messageParams: {
            code: params.code,
            system: params.system,
            valueSet: params.valueSet,
            strength: params.strength,
        },
    });
}

/**
 * Create a required element missing issue.
 */
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

/**
 * Create a reference type mismatch issue.
 */
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

/**
 * Create a constraint violation issue.
 */
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

/**
 * Create a generic validation error issue.
 */
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
