import type { RemoteValueSetUnverifiedReason } from '../issues/unverified-binding-diagnostic.js';

export type SubsumptionOutcome = 'subsumes' | 'subsumed-by' | 'equivalent' | 'not-subsumed' | 'unknown';

export type RemoteValueSetValidationOutcome = 'valid' | 'invalid' | 'unverified';

export interface RemoteValueSetValidationResult {
    /** Whether the remote response authoritatively established membership. */
    outcome: RemoteValueSetValidationOutcome;
    /** Backwards-compatible fail-open result exposed by TerminologyApiClient.validateCode(). */
    accepted: boolean;
    /** Why the check stayed undecided; absent for an authoritative outcome. */
    reason?: RemoteValueSetUnverifiedReason;
    /** The server that produced the result, so diagnostics can name it. */
    serverUrl?: string;
}

export interface CodeSystemValidationIssue {
    severity: 'error' | 'warning' | 'information';
    code: string;
    message: string;
    expression?: string[];
    source?: 'local-code-system' | 'terminology-server';
}

export interface CodeSystemValidationResult {
    /** Compatibility acceptance: true may also represent a skipped check; inspect reason. */
    valid: boolean;
    message?: string;
    reason?:
        | 'delegation-disabled'
        | 'no-server'
        | 'circuit-open'
        | 'code-unknown'
        | 'system-unresolvable'
        | 'display-mismatch'
        | 'display-unverified'
        | 'remote-budget-exhausted'
        | 'national-extension-unverified';
    issues?: CodeSystemValidationIssue[];
    inactive?: boolean;
    display?: string;
    displayLanguage?: string;
    /** The local CodeSystem does not declare complete content, so absence is not proof. */
    incompleteCodeSystem?: boolean;
}
