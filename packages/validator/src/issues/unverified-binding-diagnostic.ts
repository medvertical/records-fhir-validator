/**
 * Why a binding stayed unverified, in terms an operator can act on: which
 * local store answered, which servers were asked and how each answered.
 */

/** Why local resolution could not decide; `TERMINOLOGY_UNVERIFIED_REASONS` in the validators must stay within this set. */
export type UnverifiedBindingCause =
    | 'empty-expansion'
    | 'unsupported-filter'
    | 'unenumerable-system-include'
    | 'unresolvable-snomed-extension-filter'
    | 'versioned-binding-unverified'
    | 'validation-error';

/** How a terminology server left a `$validate-code` request undecided. */
export type RemoteValueSetUnverifiedReason =
    | 'delegation-disabled'
    | 'no-server'
    | 'circuit-open'
    | 'value-set-not-found'
    | 'server-failure';

export interface TerminologyServerAttempt {
    url: string;
    reason: RemoteValueSetUnverifiedReason;
}

export interface UnverifiedBindingDiagnostic {
    cause: UnverifiedBindingCause;
    /** `none`: no definition in any store; `incomplete`: found, but not enumerable locally. */
    localExpansion: 'none' | 'incomplete';
    serverAttempts: TerminologyServerAttempt[];
    /** Present when no server was asked at all. */
    serverSkipped?: 'no-server' | 'delegation-disabled' | 'not-needed';
    /** Whether the tenant's installed packages were part of the local stores. */
    packageScope: 'tenant' | 'none';
}

const SERVER_FAILURE_REASONS = new Set<RemoteValueSetUnverifiedReason>([
    'server-failure',
    'circuit-open',
]);

/** Identity of one binding decision, shared by the resolver and the issue builder. */
export function unverifiedBindingKey(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion: string | undefined,
    codeSystemVersion: string | undefined,
): string {
    return JSON.stringify([fhirVersion ?? '', valueSetUrl, system ?? '', code, codeSystemVersion ?? '']);
}

/**
 * Every asked server failed rather than answered. That is an execution
 * failure of the check, not an unknown value set, and is reported as such.
 */
export function isTerminologyServerFailure(diagnostic: UnverifiedBindingDiagnostic): boolean {
    return diagnostic.serverAttempts.length > 0
        && diagnostic.serverAttempts.every(attempt => SERVER_FAILURE_REASONS.has(attempt.reason));
}

export function describeUnverifiedBinding(diagnostic: UnverifiedBindingDiagnostic): string {
    if (isTerminologyServerFailure(diagnostic)) {
        return 'The configured terminology servers did not answer (timeout, error, or open circuit). '
            + 'Check connectivity and server health, then validate again.';
    }
    switch (diagnostic.cause) {
        case 'empty-expansion':
            return diagnostic.serverAttempts.length > 0
                ? 'No installed package defines this value set and the configured terminology servers do not know it. '
                    + 'Install the IG package that defines it, or configure a terminology server that serves it.'
                : 'No installed package defines this value set and no terminology server was asked for this FHIR release. '
                    + 'Install the IG package that defines it, or configure a terminology server.';
        case 'unsupported-filter':
        case 'unenumerable-system-include':
        case 'unresolvable-snomed-extension-filter':
            return 'The value set definition was found, but its compose rules cannot be evaluated locally. '
                + 'Configure a terminology server that knows the value set, or install the package that carries the complete CodeSystem.';
        case 'versioned-binding-unverified':
            return 'The coding pins a CodeSystem version; only a terminology server that serves that version can confirm the code.';
        case 'validation-error':
            return 'The binding check failed unexpectedly. Check the validator logs, then validate again.';
    }
}

/** Issue `details` carrying the diagnostic in the shape the inspection UI reads. */
export function unverifiedBindingDetails(
    diagnostic: UnverifiedBindingDiagnostic,
): Record<string, unknown> {
    return {
        terminologyDiagnostic: {
            kind: isTerminologyServerFailure(diagnostic) ? 'terminology-server-failure' : 'binding-unverified',
            cause: diagnostic.cause,
            localExpansion: diagnostic.localExpansion,
            serverAttempts: diagnostic.serverAttempts,
            ...(diagnostic.serverSkipped ? { serverSkipped: diagnostic.serverSkipped } : {}),
            packageScope: diagnostic.packageScope,
        },
        recommendation: describeUnverifiedBinding(diagnostic),
    };
}
