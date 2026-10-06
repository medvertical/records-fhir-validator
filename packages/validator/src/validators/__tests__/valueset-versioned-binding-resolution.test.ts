import { describe, expect, it, vi } from 'vitest';

import { resolveBindingCodeSystemVersion, resolveValueSetCodeBinding } from '../valueset-code-binding-resolver';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics';
import type { CodeBindingOutcome, CodeSystem, ValueSet, TerminologyResolutionConfig } from '../valueset-types';

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
  const packageLoader = {
    loadCodeSystem: vi.fn(async (): Promise<CodeSystem | null> => null),
    loadValueSetResource: vi.fn(async (): Promise<ValueSet | null> => null),
  };
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
      packageLoader: packageLoader as never,
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
    packageLoader,
    lookup,
    terminologyDiagnostics,
    validateViaServer,
  };
}

describe('versioned ValueSet binding resolution', () => {
  it.each(['local-first', 'local-only', 'server-first'] as const)('uses exact local evidence under %s without using versionless expansion shortcuts', async strategy => {
    const harness = createHarness('unverified');
    harness.deps.resolutionConfig.strategy = strategy;
    harness.packageLoader.loadCodeSystem.mockResolvedValue({ resourceType: 'CodeSystem', url: SYSTEM,
      version: VERSION, content: 'complete', concept: [{ code: '123' }] });
    harness.packageLoader.loadValueSetResource.mockResolvedValue({ resourceType: 'ValueSet', url: VALUE_SET,
      status: 'active', compose: { include: [{ system: SYSTEM }] } });
    await expect(resolveValueSetCodeBinding(harness.deps, '123', SYSTEM, VALUE_SET, 'required', 'R4', undefined, VERSION)).resolves.toBe('valid');
    expect(harness.validateViaServer).toHaveBeenCalledTimes(strategy === 'server-first' ? 1 : 0);
    expect(harness.getExpandedValueSet).not.toHaveBeenCalled();
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it('does not replace an authoritative server rejection with local membership under server-first', async () => {
    const harness = createHarness('invalid');
    harness.packageLoader.loadCodeSystem.mockResolvedValue({ resourceType: 'CodeSystem', url: SYSTEM,
      version: VERSION, content: 'complete', concept: [{ code: '123' }] });
    await expect(resolveValueSetCodeBinding(harness.deps, '123', SYSTEM, VALUE_SET, 'required', 'R4', undefined, VERSION)).resolves.toBe('invalid');
    expect(harness.packageLoader.loadCodeSystem).not.toHaveBeenCalled();
  });

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


describe('caller CodeSystem defaults preserve explicit binding editions', () => {
  it('keeps explicit Coding.version and compose.include.version ahead of the caller default', async () => {
    const harness = createHarness('unverified');
    const config: TerminologyResolutionConfig = { strategy: 'local-only', defaultCodeSystemVersions: { [SYSTEM]: 'edition-A' } };
    harness.packageLoader.loadValueSetResource.mockResolvedValue({ resourceType: 'ValueSet', url: VALUE_SET,
      status: 'active', compose: { include: [{ system: SYSTEM, version: 'edition-B' }] } });
    const select = (version?: string) => resolveBindingCodeSystemVersion(config, harness.packageLoader as never, SYSTEM, VALUE_SET, 'R4', version);
    await expect(select('edition-C')).resolves.toBe('edition-C');
    expect(harness.packageLoader.loadValueSetResource).not.toHaveBeenCalled();
    await expect(select()).resolves.toBe('edition-B');
    config.defaultCodeSystemVersions = undefined;
    harness.packageLoader.loadValueSetResource.mockClear();
    await expect(select()).resolves.toBeUndefined();
    expect(harness.packageLoader.loadValueSetResource).not.toHaveBeenCalled();
  });

  it.each([
    { include: [{ system: SYSTEM, version: 'edition-B' }, { system: SYSTEM, version: 'edition-C' }] },
    { include: [{ system: SYSTEM, version: 'edition-B' }, { system: SYSTEM }] },
    { include: [{ system: SYSTEM, version: '*' }] },
  ])('does not collapse compose edition alternatives into a caller default: %j', async ({ include }) => {
    const harness = createHarness('unverified');
    harness.packageLoader.loadValueSetResource.mockResolvedValue({ resourceType: 'ValueSet', url: VALUE_SET,
      status: 'active', compose: { include } });
    await expect(resolveBindingCodeSystemVersion({ strategy: 'local-only', defaultCodeSystemVersions: { [SYSTEM]: 'edition-A' } },
      harness.packageLoader as never, SYSTEM, VALUE_SET, 'R4')).resolves.toBeUndefined();
  });
});
