import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValueSet } from '../valueset-types';

const VALUE_SET_URL = 'http://example.org/fhir/ValueSet/filtered-required';
const UNSUPPORTED_FILTER_VALUE_SET_URL = 'http://example.org/fhir/ValueSet/loinc-filtered';
const SNOMED = 'http://snomed.info/sct';
const LOINC = 'http://loinc.org';

async function writePackage(root: string, valueSet: ValueSet): Promise<void> {
  const packageDir = path.join(root, 'test.package#1.0.0', 'package');
  await mkdir(packageDir, { recursive: true });
  const filename = `ValueSet-${valueSet.url?.split('/').pop() ?? 'test'}.json`;
  await writeFile(
    path.join(packageDir, filename),
    JSON.stringify(valueSet, null, 2)
  );
}

function filteredValueSet(): ValueSet {
  return {
    resourceType: 'ValueSet',
    url: VALUE_SET_URL,
    status: 'active',
    compose: {
      include: [
        {
          system: SNOMED,
          concept: [{ code: 'explicit-code' }],
        },
        {
          system: SNOMED,
          filter: [{ property: 'concept', op: 'is-a', value: '404684003' }],
        },
      ],
    },
  };
}

function unsupportedFilteredValueSet(): ValueSet {
  return {
    resourceType: 'ValueSet',
    url: UNSUPPORTED_FILTER_VALUE_SET_URL,
    status: 'active',
    compose: {
      include: [
        {
          system: LOINC,
          concept: [{ code: 'explicit-code' }],
        },
        {
          system: LOINC,
          filter: [{ property: 'CLASSTYPE', op: '=', value: '1' }],
        },
      ],
    },
  };
}

describe('ValueSet filtered include server delegation', () => {
  let tempDir: string;
  let previousCachePath: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    previousCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'records-filtered-vs-'));
    process.env.FHIR_PACKAGE_CACHE_PATH = tempDir;
    await writePackage(tempDir, filteredValueSet());
    await writePackage(tempDir, unsupportedFilteredValueSet());
  });

  afterEach(async () => {
    if (previousCachePath === undefined) {
      delete process.env.FHIR_PACKAGE_CACHE_PATH;
    } else {
      process.env.FHIR_PACKAGE_CACHE_PATH = previousCachePath;
    }
    vi.doUnmock('axios');
    await rm(tempDir, { recursive: true, force: true });
  });

  it('delegates required filtered ValueSets even when local expansion is partial', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: true }],
      },
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });

    await expect(
      validator.isCodeValidForBinding('descendant-code', SNOMED, VALUE_SET_URL, 'required')
    ).resolves.toBe(true);
    expect(validator.getCacheStats().terminologyDiagnostics.delegatedBindings).toEqual({
      total: 1,
      byReason: {
        'server-validate-code': 1,
      },
    });
    expect(get).toHaveBeenCalledWith(
      'https://tx.example/fhir/ValueSet/$validate-code',
      expect.objectContaining({
        params: expect.objectContaining({
          url: VALUE_SET_URL,
          system: SNOMED,
          code: 'descendant-code',
        }),
      })
    );
  });

  it('falls back to CodeSystem $subsumes for concept is-a filters', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.endsWith('/ValueSet/$validate-code')) {
        return {
          data: {
            resourceType: 'Parameters',
            parameter: [{ name: 'result', valueBoolean: false }],
          },
        };
      }
      if (url.endsWith('/CodeSystem/$subsumes')) {
        return {
          data: {
            resourceType: 'Parameters',
            parameter: [{ name: 'outcome', valueCode: 'subsumes' }],
          },
        };
      }
      throw new Error(`Unexpected terminology request: ${url}`);
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
    });

    await expect(
      validator.isCodeValidForBinding('descendant-code', SNOMED, VALUE_SET_URL, 'required')
    ).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(
      'https://tx.example/fhir/CodeSystem/$subsumes',
      expect.objectContaining({
        params: expect.objectContaining({
          system: SNOMED,
          codeA: '404684003',
          codeB: 'descendant-code',
        }),
      })
    );
  });

  it('fails open for non-required SNOMED national-extension codes in filtered ValueSets', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.endsWith('/ValueSet/$validate-code')) {
        return {
          data: {
            resourceType: 'Parameters',
            parameter: [{ name: 'result', valueBoolean: false }],
          },
        };
      }
      if (url.endsWith('/CodeSystem/$subsumes')) {
        return {
          data: {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'not-found' }],
          },
        };
      }
      throw new Error(`Unexpected terminology request: ${url}`);
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
    });

    await expect(
      validator.isCodeValidForBinding('449411000124106', SNOMED, VALUE_SET_URL, 'extensible')
    ).resolves.toBe(true);
  });

  it('keeps required SNOMED national-extension bindings strict in filtered ValueSets', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.endsWith('/ValueSet/$validate-code')) {
        return {
          data: {
            resourceType: 'Parameters',
            parameter: [{ name: 'result', valueBoolean: false }],
          },
        };
      }
      if (url.endsWith('/CodeSystem/$subsumes')) {
        return {
          data: {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'not-found' }],
          },
        };
      }
      throw new Error(`Unexpected terminology request: ${url}`);
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
    });

    await expect(
      validator.isCodeValidForBinding('449411000124106', SNOMED, VALUE_SET_URL, 'required')
    ).resolves.toBe(false);
  });

  it('does not warn on non-required bindings when a ValueSet uses unsupported terminology filters', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'result', valueBoolean: false },
          { name: 'message', valueString: 'ValueSet could not be resolved by this terminology server' },
        ],
      },
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });

    await expect(
      validator.isCodeValidForBinding('58410-2', LOINC, UNSUPPORTED_FILTER_VALUE_SET_URL, 'extensible')
    ).resolves.toBe(true);
    expect(validator.getCacheStats().terminologyDiagnostics.unverifiedBindings.byReason['unsupported-filter']).toBe(1);
  });

  it('fails open for direct membership checks against unsupported terminology filters', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: false }],
      },
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });

    await expect(
      validator.isCodeInValueSet('58410-2', LOINC, UNSUPPORTED_FILTER_VALUE_SET_URL)
    ).resolves.toBe(true);
    expect(validator.getCacheStats().terminologyDiagnostics.failOpenMembershipChecks.byReason['unsupported-filter']).toBe(1);
  });

  it('keeps required bindings strict when unsupported terminology filters are only partially expanded', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: false }],
      },
    });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-first',
      serverUrl: 'https://tx.example/fhir',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });

    await expect(
      validator.isCodeValidForBinding('58410-2', LOINC, UNSUPPORTED_FILTER_VALUE_SET_URL, 'required')
    ).resolves.toBe(false);
  });
});
