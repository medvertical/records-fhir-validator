import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics';
import { expandValueSet } from '../valueset-expansion-loader';
import { validateValueSetMembership } from '../valueset-membership-validator';
import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetValidator } from '../valueset-validator';
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
  afterEach(() => vi.restoreAllMocks());
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

  it.each([
    { strategy: 'server-first' as const, validateCodes: false },
    { strategy: 'local-only' as const, validateCodes: true },
    { strategy: 'local-only' as const, validateCodes: undefined },
  ])('keeps an unavailable binding Unknown without delegation (%j)', async ({ strategy, validateCodes }) => {
    const validateViaServer = vi.fn(async () => 'valid' as const);
    const outcome = await resolveValueSetCodeBinding({
      getExpandedValueSet: vi.fn(async () => new Set<string>()),
      hasTerminologyServer: vi.fn(() => true),
      packageLoader: {
        getIncludeConceptFilters: vi.fn(async () => []),
        getUnenumerableSystemIncludes: vi.fn(async () => []),
        hasIncompleteExpansion: vi.fn(async () => false),
        getComposeSystems: vi.fn(async () => null),
      } as never,
      resolutionConfig: { ...config, strategy, serverDelegation: validateCodes === undefined
        ? undefined : { ...config.serverDelegation!, validateCodes } },
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
      getExpandedValueSet: vi.fn(async () => new Set<string>()),
      packageLoader: {
        getIncludeConceptFilters: vi.fn(async () => []),
        hasIncompleteExpansion: vi.fn(async () => false),
        loadValueSetResource: vi.fn(async () => null),
      } as never,
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
      getExpandedValueSet: vi.fn(async () => new Set<string>()),
      packageLoader: {
        getIncludeConceptFilters: vi.fn(async () => []),
        hasIncompleteExpansion: vi.fn(async () => false),
        loadValueSetResource: vi.fn(async () => null),
      } as never,
      resolutionConfig: {
        ...config,
        serverDelegation: {
          ...config.serverDelegation!,
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

    await expect(operations.validate('123', 'http://loinc.org')).resolves.toMatchObject({ valid: true, reason: 'delegation-disabled' });
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
    )).resolves.toMatchObject({ valid: true, reason: 'delegation-disabled' });
    await expect(client.subsumes('http://snomed.info/sct', 'a', 'b'))
      .resolves.toBe('unknown');
  });
  it.each([
    { strategy: 'local-only' as const, validateCodes: true, allowed: false },
    { strategy: 'local-first' as const, validateCodes: false, allowed: false },
    { strategy: 'server-first' as const, validateCodes: false, allowed: false },
    { strategy: 'local-first' as const, validateCodes: true, allowed: true },
    { strategy: 'server-first' as const, validateCodes: true, allowed: true },
  ])('applies the delegation policy before the actual missing-ValueSet fallback (%j)', async ({ strategy, validateCodes, allowed }) => {
    const primary = `https://${strategy}-${validateCodes}.example.test/fhir`;
    const fallback = `https://fallback-${strategy}-${validateCodes}.example.test/fhir`;
    const get = vi.spyOn(axios, 'get').mockImplementation(async url => ({ data: {
      resourceType: 'Parameters',
      parameter: url === `${fallback}/ValueSet/$validate-code` ? [{ name: 'result', valueBoolean: true }] : [],
    } }));
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('unexpected inline definition request'));
    const validator = new ValueSetValidator(new ValueSetCache(), undefined, []);
    validator.setResolutionConfig({ ...config, strategy, serverUrl: primary,
      servers: [
        { id: 'primary', url: primary, enabled: true, fhirVersions: ['R4'] },
        { id: 'fallback', url: fallback, enabled: true, fhirVersions: ['R4'] },
      ],
      serverDelegation: { ...config.serverDelegation!, validateCodes },
      reportUnverifiedBindings: true,
    });
    const issues = await validator.validateBinding(
      { coding: [{ system: 'https://example.test/CodeSystem/missing-value-set', code: 'b' }] },
      { strength: 'required', valueSet: 'https://example.test/ValueSet/missing|2.3.0' },
      'Patient.identifier[0].type', { fhirVersion: 'R4' },
    );
    if (allowed) {
      expect(issues).toEqual([]);
      expect(get.mock.calls.map(call => call[0])).toEqual([
        `${primary}/ValueSet/$validate-code`, `${fallback}/ValueSet/$validate-code`,
      ]);
    } else {
      expect(issues).toEqual([expect.objectContaining({ code: 'terminology-binding-unverified',
        details: expect.objectContaining({ validationStatus: 'incomplete', terminologyDiagnostic: expect.objectContaining({ serverSkipped: 'delegation-disabled', serverAttempts: [] }) }) })]);
      expect(get).not.toHaveBeenCalled();
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('blocks local-only direct API validation even with enabled delegation and a server override', async () => {
    const get = vi.spyOn(axios, 'get').mockRejectedValue(new Error('unexpected remote request'));
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('unexpected remote request'));
    const client = new TerminologyApiClient({ ...config, strategy: 'local-only',
      serverDelegation: { ...config.serverDelegation!, validateCodes: true } });
    await expect(client.validateCodeAttempt('code', 'https://example.test/CodeSystem/x',
      'https://example.test/ValueSet/missing', 'required', { url: 'https://fallback.example.test/fhir' }))
      .resolves.toMatchObject({ outcome: 'unverified', reason: 'delegation-disabled' });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

});
