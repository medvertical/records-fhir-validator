/**
 * Issues that make a skipped terminology check visible instead of silent.
 */

import type { ValidationIssue, ValidationSeverity } from '@records-fhir/validation-types';
import { createValidationIssue } from './issue-factory.js';
import {
    isTerminologyServerFailure,
    unverifiedBindingDetails,
    type UnverifiedBindingDiagnostic,
} from './unverified-binding-diagnostic.js';

/**
 * Create a "binding could not be verified" informational issue.
 *
 * Emitted when a coded element's ValueSet cannot be expanded locally and no
 * terminology server confirmed the code. Distinct from a binding violation:
 * the code is not known to be wrong, only unverifiable. Severity is
 * informational so it never gates, but the skip becomes visible instead of
 * silent (gap P-3). When every asked server failed rather than answered, the
 * check did not run and the issue says so under `terminology-server-failure`,
 * at the same severity so an outage never changes the gating verdict.
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
    diagnostic?: UnverifiedBindingDiagnostic;
}): ValidationIssue {
    const serverFailure = params.diagnostic !== undefined && isTerminologyServerFailure(params.diagnostic);
    return createValidationIssue({
        code: serverFailure ? 'terminology-server-failure' : 'terminology-binding-unverified',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        severityOverride: params.severityOverride ?? (serverFailure ? 'information' : undefined),
        details: {
            validationStatus: 'incomplete',
            reason: serverFailure ? 'server-failure' : 'binding-unverified',
            ...(params.diagnostic ? unverifiedBindingDetails(params.diagnostic) : {}),
        },
        messageParams: {
            code: params.code,
            system: params.system,
            valueSet: params.valueSet,
            strength: params.strength,
        },
    });
}

/**
 * Create a visible completeness diagnostic when the bound ValueSet itself
 * cannot be resolved. This also covers text-only CodeableConcept values: even
 * without a Coding to test, an unavailable additional binding must not vanish
 * from the validation result.
 */
export function createValueSetUnavailable(params: {
    strength: 'required' | 'extensible' | 'preferred';
    valueSet: string;
    path: string;
    resourceType: string;
    profile?: string;
    severityOverride?: ValidationSeverity;
}): ValidationIssue {
    return createValidationIssue({
        code: 'terminology-valueset-unavailable',
        path: params.path,
        resourceType: params.resourceType,
        profile: params.profile,
        severityOverride: params.severityOverride,
        details: {
            validationStatus: 'incomplete',
            reason: 'valueset-unavailable',
            recommendation: 'No installed package defines this value set and no terminology server could resolve it. '
                + 'Install the IG package that defines it, or configure a terminology server that serves it.',
        },
        messageParams: {
            valueSet: params.valueSet,
            strength: params.strength,
        },
    });
}
