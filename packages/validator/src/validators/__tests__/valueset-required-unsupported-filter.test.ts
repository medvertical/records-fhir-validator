import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValueSet } from '../valueset-types';

const DOC_TYPE_VALUE_SET_URL = 'http://example.org/fhir/ValueSet/doc-type';
const ENUMERATED_VALUE_SET_URL = 'http://example.org/fhir/ValueSet/enumerated-status';
const LOINC = 'http://loinc.org';
const NULL_FLAVOR = 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor';

async function writePackage(root: string, valueSet: ValueSet): Promise<void> {
  const packageDir = path.join(root, 'test.package#1.0.0', 'package');
  await mkdir(packageDir, { recursive: true });
  const filename = `ValueSet-${valueSet.url?.split('/').pop() ?? 'test'}.json`;
  await writeFile(path.join(packageDir, filename), JSON.stringify(valueSet, null, 2));
}

/** us-core-documentreference-type shape: enumerated NullFlavor + LOINC property filter. */
function docTypeValueSet(): ValueSet {
  return {
    resourceType: 'ValueSet',
    url: DOC_TYPE_VALUE_SET_URL,
    status: 'active',
    compose: {
      include: [
        { system: NULL_FLAVOR, concept: [{ code: 'UNK' }] },
        { system: LOINC, filter: [{ property: 'SCALE_TYP', op: '=', value: 'LP32888-7' }] },
      ],
    },
  };
}

function enumeratedValueSet(): ValueSet {
  return {
    resourceType: 'ValueSet',
    url: ENUMERATED_VALUE_SET_URL,
    status: 'active',
    compose: {
      include: [
        {
          system: 'http://example.org/fhir/CodeSystem/status',
          concept: [{ code: 'planned' }, { code: 'active' }],
        },
      ],
    },
  };
}

describe('required bindings against locally unexpandable filter ValueSets', () => {
  let tempDir: string;
  let previousCachePath: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    previousCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'records-required-filter-vs-'));
    process.env.FHIR_PACKAGE_CACHE_PATH = tempDir;
    await writePackage(tempDir, docTypeValueSet());
    await writePackage(tempDir, enumeratedValueSet());
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

  async function offlineValidator() {
    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.clearCache();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });
    return validator;
  }

  it('degrades a required miss to unverified when the coded system has an unsupported filter', async () => {
    const validator = await offlineValidator();

    await expect(
      validator.resolveCodeBindingForBinding('34133-9', LOINC, DOC_TYPE_VALUE_SET_URL, 'required'),
    ).resolves.toBe('unverified');
    expect(
      validator.getCacheStats().terminologyDiagnostics.unverifiedBindings.byReason['unsupported-filter'],
    ).toBe(1);
  });

  it('keeps the authoritative miss for the enumerated system of the same ValueSet', async () => {
    const validator = await offlineValidator();

    await expect(
      validator.resolveCodeBindingForBinding('NOPE', NULL_FLAVOR, DOC_TYPE_VALUE_SET_URL, 'required'),
    ).resolves.toBe('invalid');
  });

  it('keeps the authoritative miss for a fully enumerated compose', async () => {
    const validator = await offlineValidator();

    await expect(
      validator.resolveCodeBindingForBinding(
        'bogus',
        'http://example.org/fhir/CodeSystem/status',
        ENUMERATED_VALUE_SET_URL,
        'required',
      ),
    ).resolves.toBe('invalid');
  });

  it('keeps a server-confirmed required miss even with an unsupported filter', async () => {
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
    });

    await expect(
      validator.resolveCodeBindingForBinding('34133-9', LOINC, DOC_TYPE_VALUE_SET_URL, 'required'),
    ).resolves.toBe('invalid');
    expect(get).toHaveBeenCalled();
  });

  it('leaves a partial expansion unverified when the configured server cannot resolve the binding', async () => {
    const get = vi.fn().mockResolvedValue({ data: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'result', valueBoolean: false },
        { name: 'issues', resource: {
          resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }],
        } },
      ],
    } });
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return { ...actual, default: { ...actual.default, get } };
    });
    const { ValueSetValidator } = await import('../valueset-validator');
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-first', serverUrl: 'https://unavailable-vs.example/fhir',
      serverDelegation: { expandValueSets: false, validateCodes: true, cacheResults: false, cacheTTLSeconds: 0 },
    });
    await expect(validator.resolveCodeBindingForBinding(
      '34133-9', LOINC, DOC_TYPE_VALUE_SET_URL, 'required',
    )).resolves.toBe('unverified');
    expect(get).toHaveBeenCalled();
  });
});
