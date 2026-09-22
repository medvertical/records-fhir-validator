import { describe, expect, it, vi } from 'vitest';

import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics';
import type { CodeBindingOutcome, TerminologyResolutionConfig } from '../valueset-types';

const SYSTEM = 'http://snomed.info/sct';
const VERSION = 'http://snomed.info/sct/999000041000000102/version/20250701';
const VALUE_SET = 'http://example.test/ValueSet/uk-codes';

function createHarness(remoteResult: CodeBindingOutcome) {
  const getExpandedValueSet = vi.fn(async () => new Set([`${SYSTEM}|123`]));
  const lookup = vi.fn(async () => ({
    status: 'hit' as const,
    coverage: 'complete' as const,
    source: 'test',
  }));
  const validateViaServer = vi.fn(async () => remoteResult);
  const terminologyDiagnostics = createEmptyTerminologyDiagnostics();
  const resolutionConfig: TerminologyResolutionConfig = {
    strategy: 'server-first',
    serverDelegation: {
      cacheResults: false,
      cacheTTLSeconds: 0,
      expandValueSets: false,
      validateCodes: true,
    },
  };
  return {
    deps: {
      getExpandedValueSet,
      hasTerminologyServer: vi.fn(() => true),
      packageLoader: {} as never,
      resolutionConfig,
      resolveServerForSystem: vi.fn(() => ({
        url: 'https://uk-snomed.example/fhir',
        authoritativeSnomedEdition: true,
      })),
      terminologyDiagnostics,
      twoPhaseShadow: {
        finish: vi.fn((_lookup: unknown, result: boolean) => result),
        getEnforcedResult: vi.fn(() => true),
        lookup,
      } as never,
      validateViaServer,
    },
    getExpandedValueSet,
    lookup,
    terminologyDiagnostics,
    validateViaServer,
  };
}

describe('versioned ValueSet binding resolution', () => {
  it('bypasses versionless local shortcuts and stays unverified without remote confirmation', async () => {
    const harness = createHarness('unverified');

    await expect(resolveValueSetCodeBinding(
      harness.deps,
      '123',
      SYSTEM,
      VALUE_SET,
      'required',
      'R4',
      'Observation.code',
      VERSION,
    )).resolves.toBe('unverified');

    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.getExpandedValueSet).not.toHaveBeenCalled();
    expect(harness.validateViaServer).toHaveBeenCalledWith(
      '123',
      SYSTEM,
      VALUE_SET,
      'required',
      expect.objectContaining({ url: 'https://uk-snomed.example/fhir' }),
      'R4',
      VERSION,
      expect.any(Array),
    );
    expect(
      harness.terminologyDiagnostics.unverifiedBindings.byReason['versioned-binding-unverified'],
    ).toBe(1);
  });

  it.each(['required', 'extensible', 'preferred'] as const)(
    'preserves an authoritative remote rejection for a %s binding',
    async bindingStrength => {
      const harness = createHarness('invalid');

      await expect(resolveValueSetCodeBinding(
        harness.deps,
        '123',
        SYSTEM,
        VALUE_SET,
        bindingStrength,
        'R4',
        'Observation.code',
        VERSION,
      )).resolves.toBe('invalid');

      expect(
        harness.terminologyDiagnostics.unverifiedBindings.byReason['versioned-binding-unverified'],
      ).toBe(0);
    },
  );

  it('accepts a versioned binding only after authoritative remote confirmation', async () => {
    const harness = createHarness('valid');

    await expect(resolveValueSetCodeBinding(
      harness.deps,
      '123',
      SYSTEM,
      VALUE_SET,
      'required',
      'R4',
      'Observation.code',
      VERSION,
    )).resolves.toBe('valid');

    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.getExpandedValueSet).not.toHaveBeenCalled();
    expect(harness.terminologyDiagnostics.delegatedBindings.total).toBe(1);
  });
});
