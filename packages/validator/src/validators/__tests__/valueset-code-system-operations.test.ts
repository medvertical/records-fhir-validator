import { describe, expect, it, vi } from 'vitest';

import { ValueSetCache } from '../valueset-cache';
import { ValueSetCodeSystemOperations } from '../valueset-code-system-operations';
import type { TerminologyResolutionConfig } from '../valueset-types';

const SNOMED_SYSTEM = 'http://snomed.info/sct';
const INTERNATIONAL_VERSION =
  'http://snomed.info/sct/900000000000207008/version/20250701';
const UK_VERSION =
  'http://snomed.info/sct/999000041000000102/version/20250701';

describe('ValueSetCodeSystemOperations', () => {
  it.each([
    { enabled: true, fhirVersions: ['R4'], scoped: true, delegated: true },
    { enabled: false, fhirVersions: ['R4'], scoped: true, delegated: false },
    { enabled: true, fhirVersions: ['R5'], scoped: true, delegated: false },
    { enabled: true, fhirVersions: ['R4'], scoped: false, delegated: false },
  ])('validates additional CodeSystems only through an eligible explicit scope: %j', async entry => {
    const system = 'http://hl7.org/fhir/sid/icd-10';
    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({ valid: false, reason: 'code-unknown' });
    const config: TerminologyResolutionConfig = { strategy: 'local-first', servers: [{
      id: 'icd', url: 'https://icd.example/fhir', enabled: entry.enabled,
      fhirVersions: entry.fhirVersions as ('R4' | 'R5')[], preferredSystems: entry.scoped ? [system] : [],
    }] };
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem } as never, cache: new ValueSetCache(),
      getResolutionConfig: () => config, packageLoader: { loadCodeSystem: vi.fn().mockResolvedValue(null) } as never,
    });
    const result = await operations.validate('S02.40FA', system, undefined, 'R4');
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(entry.delegated ? 1 : 0);
    expect(result.valid).toBe(!entry.delegated);
  });

  it('does not use an unversioned local SNOMED cache for another requested edition', async () => {
    const cache = new ValueSetCache();
    cache.setCodeSystem(SNOMED_SYSTEM, {
      resourceType: 'CodeSystem',
      url: SNOMED_SYSTEM,
      version: INTERNATIONAL_VERSION,
      content: 'complete',
      concept: [{ code: '123456', display: 'International concept' }],
    });
    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'code-unknown',
      message: 'Unknown in UK edition',
    });
    const loadCodeSystem = vi.fn().mockResolvedValue(null);
    const config: TerminologyResolutionConfig = {
      strategy: 'server-first',
      serverUrl: 'https://default-tx.example/fhir',
      servers: [{
        id: 'uk-edition',
        url: 'https://uk-tx.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
        snomedEditions: ['999000041000000102'],
      }],
      serverDelegation: {
        cacheResults: false,
        cacheTTLSeconds: 0,
        expandValueSets: false,
        validateCodes: true,
      },
    };
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem } as never,
      cache,
      getResolutionConfig: () => config,
      packageLoader: { loadCodeSystem } as never,
    });

    const result = await operations.validate(
      '123456',
      SNOMED_SYSTEM,
      undefined,
      'R4',
      UK_VERSION,
    );

    expect(loadCodeSystem).toHaveBeenCalledWith(SNOMED_SYSTEM, '4', UK_VERSION);
    expect(validateCodeInCodeSystem).toHaveBeenCalledWith(
      '123456',
      SNOMED_SYSTEM,
      undefined,
      {
        url: 'https://uk-tx.example/fhir',
        auth: undefined,
        authoritativeSnomedEdition: true,
      },
      UK_VERSION,
    );
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown' });
  });

  it('does not call a matching edition server for another FHIR release', async () => {
    const validateCodeInCodeSystem = vi.fn();
    const loadCodeSystem = vi.fn().mockResolvedValue(null);
    const config: TerminologyResolutionConfig = {
      strategy: 'server-first',
      serverUrl: 'https://uk-r4.example/fhir',
      servers: [{
        id: 'uk-r4',
        url: 'https://uk-r4.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
        snomedEditions: ['999000041000000102'],
      }],
      serverDelegation: {
        cacheResults: false,
        cacheTTLSeconds: 0,
        expandValueSets: false,
        validateCodes: true,
      },
    };
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem } as never,
      cache: new ValueSetCache(),
      getResolutionConfig: () => config,
      packageLoader: { loadCodeSystem } as never,
    });

    const result = await operations.validate(
      '123456',
      SNOMED_SYSTEM,
      undefined,
      'R5',
      UK_VERSION,
    );

    expect(validateCodeInCodeSystem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ valid: false, reason: 'system-unresolvable' });
  });

  it('does not send an unmatched SNOMED edition to a generic preferred server', async () => {
    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({ valid: true });
    const loadCodeSystem = vi.fn().mockResolvedValue(null);
    const config: TerminologyResolutionConfig = {
      strategy: 'server-first',
      serverUrl: 'https://generic-snomed.example/fhir',
      servers: [{
        id: 'generic-snomed',
        url: 'https://generic-snomed.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
        preferredSystems: [SNOMED_SYSTEM],
      }],
      serverDelegation: {
        cacheResults: false,
        cacheTTLSeconds: 0,
        expandValueSets: false,
        validateCodes: true,
      },
    };
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem } as never,
      cache: new ValueSetCache(),
      getResolutionConfig: () => config,
      packageLoader: { loadCodeSystem } as never,
    });

    const result = await operations.validate(
      '35901911000001104',
      SNOMED_SYSTEM,
      undefined,
      'R4',
      UK_VERSION,
    );

    expect(validateCodeInCodeSystem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ valid: false, reason: 'system-unresolvable' });
  });

  it('uses a compatible generic server when the configured default is for another release', async () => {
    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({ valid: true });
    const loadCodeSystem = vi.fn().mockResolvedValue(null);
    const config: TerminologyResolutionConfig = {
      strategy: 'server-first',
      serverUrl: 'https://r4.example/fhir',
      servers: [
        {
          id: 'r4-default',
          url: 'https://r4.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'r5-generic',
          url: 'https://r5.example/fhir',
          enabled: true,
          fhirVersions: ['R5'],
        },
      ],
      serverDelegation: {
        cacheResults: false,
        cacheTTLSeconds: 0,
        expandValueSets: false,
        validateCodes: true,
      },
    };
    const operations = new ValueSetCodeSystemOperations({
      apiClient: { validateCodeInCodeSystem } as never,
      cache: new ValueSetCache(),
      getResolutionConfig: () => config,
      packageLoader: { loadCodeSystem } as never,
    });

    await expect(operations.validate(
      'example-code',
      'http://loinc.org',
      undefined,
      'R5',
    )).resolves.toEqual({ valid: true });
    expect(validateCodeInCodeSystem).toHaveBeenCalledWith(
      'example-code',
      'http://loinc.org',
      undefined,
      { url: 'https://r5.example/fhir', auth: undefined },
    );
  });
});
