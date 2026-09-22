import { describe, expect, it, vi } from 'vitest';

import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics';
import { expandValueSet } from '../valueset-expansion-loader';
import { validateValueSetMembership } from '../valueset-membership-validator';
import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetCodeSystemOperations } from '../valueset-code-system-operations';
import type { TerminologyResolutionConfig } from '../valueset-types';
import { TerminologyApiClient } from '../terminology-api-client';

const config: TerminologyResolutionConfig = {
  strategy: 'server-first',
  serverUrl: 'https://tx.example.test/fhir',
  serverDelegation: {
    cacheResults: false,
    cacheTTLSeconds: 0,
    expandValueSets: false,
    validateCodes: false,
  },
};

function createTwoPhaseShadow() {
  return {
    finish: vi.fn((_lookup: unknown, result: boolean) => result),
    getEnforcedResult: vi.fn(() => undefined),
    lookup: vi.fn(async () => null),
  };
}

describe('ValueSet delegation policy', () => {
  it('does not call remote expansion when expansion delegation is disabled', async () => {
    const expandRemotely = vi.fn(async () => new Set(['remote-code']));
    const result = await expandValueSet({
      apiClient: { expandValueSet: expandRemotely } as never,
      cache: new ValueSetCache(),
      packageLoader: { loadValueSet: vi.fn(async () => []) } as never,
      resolutionConfig: config,
    }, 'http://example.test/ValueSet/local-only', 'R4');

    expect(result).toEqual(new Set());
    expect(expandRemotely).not.toHaveBeenCalled();
  });

  it('does not call remote binding validation for an empty local expansion', async () => {
    const validateViaServer = vi.fn(async () => 'valid' as const);
    const outcome = await resolveValueSetCodeBinding({
      getExpandedValueSet: vi.fn(async () => new Set()),
      hasTerminologyServer: vi.fn(() => true),
      packageLoader: {
        getIncludeConceptFilters: vi.fn(async () => []),
        getUnenumerableSystemIncludes: vi.fn(async () => []),
      } as never,
      resolutionConfig: config,
      resolveServerForSystem: vi.fn(() => ({ url: config.serverUrl! })),
      terminologyDiagnostics: createEmptyTerminologyDiagnostics(),
      twoPhaseShadow: createTwoPhaseShadow() as never,
      validateViaServer,
    }, 'code', 'http://example.test/CodeSystem/x', 'http://example.test/ValueSet/x', 'required', 'R4');

    expect(outcome).toBe('unverified');
    expect(validateViaServer).not.toHaveBeenCalled();
  });

  it('does not call remote membership validation for an empty local expansion', async () => {
    const validateCodeAttempt = vi.fn(async () => ({ outcome: 'valid' as const, accepted: true }));
    const result = await validateValueSetMembership({
      apiClient: { validateCodeAttempt } as never,
      getExpandedValueSet: vi.fn(async () => new Set()),
      packageLoader: { getIncludeConceptFilters: vi.fn(async () => []), loadValueSetResource: vi.fn(async () => null) } as never,
      resolutionConfig: config,
      terminologyDiagnostics: createEmptyTerminologyDiagnostics(),
      twoPhaseShadow: createTwoPhaseShadow() as never,
    }, 'code', 'http://example.test/CodeSystem/x', 'http://example.test/ValueSet/x', 'R4');

    expect(result).toBe(false);
    expect(validateCodeAttempt).not.toHaveBeenCalled();
  });

  it('records an allowed remote membership validation', async () => {
    const validateCodeAttempt = vi.fn(async () => ({ outcome: 'valid' as const, accepted: true }));
    const terminologyDiagnostics = createEmptyTerminologyDiagnostics();
    const result = await validateValueSetMembership({
      apiClient: { validateCodeAttempt } as never,
      getExpandedValueSet: vi.fn(async () => new Set()),
      packageLoader: { getIncludeConceptFilters: vi.fn(async () => []), loadValueSetResource: vi.fn(async () => null) } as never,
      resolutionConfig: {
        ...config,
        serverDelegation: {
          ...config.serverDelegation,
          validateCodes: true,
        },
      },
      terminologyDiagnostics,
      twoPhaseShadow: createTwoPhaseShadow() as never,
    }, 'code', 'http://example.test/CodeSystem/x', 'http://example.test/ValueSet/x', 'R4');

    expect(result).toBe(true);
    expect(validateCodeAttempt).toHaveBeenCalledOnce();
    expect(terminologyDiagnostics.delegatedBindings).toEqual({
      total: 1,
      byReason: { 'server-validate-code': 1 },
    });
  });

  it('does not call remote CodeSystem or subsumption operations', async () => {
    const validateCodeInCodeSystem = vi.fn();
    const subsumes = vi.fn();
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem, subsumes } as never,
      cache: new ValueSetCache(),
      getResolutionConfig: () => config,
      packageLoader: {} as never,
    });
    vi.spyOn(operations, 'validateLocal').mockResolvedValue(null);

    await expect(operations.validate('123', 'http://loinc.org')).resolves.toEqual({ valid: true });
    await expect(operations.resolveSubsumption('http://snomed.info/sct', 'a', 'b'))
      .resolves.toBe('unknown');
    expect(validateCodeInCodeSystem).not.toHaveBeenCalled();
    expect(subsumes).not.toHaveBeenCalled();
  });

  it('enforces disabled delegation inside the low-level API client', async () => {
    const client = new TerminologyApiClient(config);

    await expect(client.expandValueSet('http://example.test/ValueSet/x')).resolves.toBeNull();
    await expect(client.validateCode(
      'code',
      'http://example.test/CodeSystem/x',
      'http://example.test/ValueSet/x',
    )).resolves.toBe(false);
    await expect(client.validateCodeInCodeSystem(
      'code',
      'http://loinc.org',
    )).resolves.toEqual({ valid: true });
    await expect(client.subsumes('http://snomed.info/sct', 'a', 'b'))
      .resolves.toBe('unknown');
  });
});
