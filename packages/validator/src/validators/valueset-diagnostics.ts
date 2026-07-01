import type {
  TerminologyDelegationCounters,
  TerminologyDelegationReason,
  TerminologyDiagnostics,
  TerminologyReasonCounters,
  TerminologyUnverifiedReason,
} from './valueset-types';

function createEmptyTerminologyReasonCounters(): TerminologyReasonCounters {
  return {
    total: 0,
    byReason: {
      'empty-expansion': 0,
      'unsupported-filter': 0,
      'unresolvable-snomed-extension-filter': 0,
      'validation-error': 0,
    },
  };
}

function createEmptyTerminologyDelegationCounters(): TerminologyDelegationCounters {
  return {
    total: 0,
    byReason: {
      'server-validate-code': 0,
    },
  };
}

export function createEmptyTerminologyDiagnostics(): TerminologyDiagnostics {
  return {
    unverifiedBindings: createEmptyTerminologyReasonCounters(),
    delegatedBindings: createEmptyTerminologyDelegationCounters(),
    failOpenMembershipChecks: createEmptyTerminologyReasonCounters(),
  };
}

function cloneTerminologyReasonCounters(counters: TerminologyReasonCounters): TerminologyReasonCounters {
  return {
    total: counters.total,
    byReason: { ...counters.byReason },
  };
}

function cloneTerminologyDelegationCounters(
  counters: TerminologyDelegationCounters,
): TerminologyDelegationCounters {
  return {
    total: counters.total,
    byReason: { ...counters.byReason },
  };
}

export function cloneTerminologyDiagnostics(diagnostics: TerminologyDiagnostics): TerminologyDiagnostics {
  return {
    unverifiedBindings: cloneTerminologyReasonCounters(diagnostics.unverifiedBindings),
    delegatedBindings: cloneTerminologyDelegationCounters(diagnostics.delegatedBindings),
    failOpenMembershipChecks: cloneTerminologyReasonCounters(diagnostics.failOpenMembershipChecks),
  };
}

export function recordTerminologyReason(
  counters: TerminologyReasonCounters,
  reason: TerminologyUnverifiedReason,
): void {
  counters.total += 1;
  counters.byReason[reason] += 1;
}

export function recordTerminologyDelegation(
  counters: TerminologyDelegationCounters,
  reason: TerminologyDelegationReason,
): void {
  counters.total += 1;
  counters.byReason[reason] += 1;
}
