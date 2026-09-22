import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_TERMINOLOGY_SERVERS } from '@records-fhir/validation-types';
import type { TerminologyServerAttempt } from '../../issues/unverified-binding-diagnostic';
import type { TerminologyApiClient } from '../terminology-api-client';
import type { ValueSetCache } from '../valueset-cache';
import { ValueSetCodeSystemOperations } from '../valueset-code-system-operations';
import type { ValueSetPackageLoader } from '../valueset-package-loader';
import { listFallbackTerminologyServers } from '../valueset-server-routing';
import { validateCodeViaTerminologyServerWithFilters } from '../valueset-terminology-server-validation';
import type { TerminologyResolutionConfig, ValueSet } from '../valueset-types';

const CSIRO = 'https://r4.ontoserver.csiro.au/fhir';
const TX_R4 = 'https://tx.fhir.org/r4';
const VSAC_RACE = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.4.642.2.575';
const CDC_RACE = 'urn:oid:2.16.840.1.113883.6.238';

const defaultConfig: TerminologyResolutionConfig = {
  strategy: 'local-first',
  serverUrl: CSIRO,
  servers: DEFAULT_TERMINOLOGY_SERVERS,
};

function apiClientAnswering(answers: Record<string, 'valid' | 'invalid' | 'unverified'>): {
  client: TerminologyApiClient;
  validateCodeAttempt: ReturnType<typeof vi.fn>;
} {
  const validateCodeAttempt = vi.fn(async (
    _code: string,
    _system: string | undefined,
    _valueSetUrl: string,
    _strength: unknown,
    override?: { url: string },
  ) => {
    const serverUrl = override?.url ?? CSIRO;
    const outcome = answers[serverUrl] ?? 'unverified';
    return {
      outcome,
      accepted: outcome === 'valid',
      serverUrl,
      ...(outcome === 'unverified' ? { reason: 'value-set-not-found' } : {}),
    };
  });
  return { client: { validateCodeAttempt } as unknown as TerminologyApiClient, validateCodeAttempt };
}

function packageLoaderWith(valueSet?: ValueSet): ValueSetPackageLoader {
  return { loadValueSetResource: async () => valueSet } as unknown as ValueSetPackageLoader;
}

describe('fallback terminology servers for a release', () => {
  it('lists the other enabled servers of the release after the routed default, in settings order', () => {
    expect(listFallbackTerminologyServers(defaultConfig, undefined, CDC_RACE, undefined, 'R4'))
      .toEqual([{ url: TX_R4, auth: undefined }]);
    expect(listFallbackTerminologyServers(defaultConfig, { url: TX_R4 }, CDC_RACE, undefined, 'R4'))
      .toEqual([{ url: CSIRO, auth: undefined }]);
  });

  it('skips servers of another release and keeps SNOMED edition requests on edition servers', () => {
    expect(listFallbackTerminologyServers(defaultConfig, undefined, 'http://loinc.org', undefined, 'R5'))
      .toEqual([{ url: 'https://tx.fhir.org/r5', auth: undefined }]);
    expect(listFallbackTerminologyServers(
      defaultConfig, { url: TX_R4 }, 'http://snomed.info/sct', 'http://snomed.info/sct/900000000000207008', 'R4',
    )).toEqual([{ url: CSIRO, auth: undefined, authoritativeSnomedEdition: true }]);
    expect(listFallbackTerminologyServers(
      defaultConfig, { url: CSIRO }, 'http://snomed.info/sct', 'http://snomed.info/sct/900000000000207008', 'R4',
    )).toEqual([{ url: TX_R4, auth: undefined, authoritativeSnomedEdition: true }]);
    expect(listFallbackTerminologyServers(
      defaultConfig, { url: CSIRO }, 'http://snomed.info/sct', 'http://snomed.info/sct/11000274103', 'R4',
    )).toEqual([]);
  });
});

describe('value set validate-code delegation across servers', () => {
  const request = (client: TerminologyApiClient, extra: Partial<Parameters<typeof validateCodeViaTerminologyServerWithFilters>[0]> = {}) =>
    validateCodeViaTerminologyServerWithFilters({
      apiClient: client,
      packageLoader: packageLoaderWith(),
      hasTerminologyServer: () => true,
      code: '2106-3',
      system: CDC_RACE,
      valueSetUrl: VSAC_RACE,
      bindingStrength: 'required',
      override: undefined,
      fhirVersion: 'R4',
      fallbackServers: [{ url: TX_R4 }],
      ...extra,
    });

  it('asks the next server when the routed server cannot resolve the value set', async () => {
    const { client, validateCodeAttempt } = apiClientAnswering({ [CSIRO]: 'unverified', [TX_R4]: 'valid' });
    const attempts: TerminologyServerAttempt[] = [];

    await expect(request(client, { attempts })).resolves.toBe('valid');

    expect(validateCodeAttempt.mock.calls.map(call => call[4]?.url)).toEqual([undefined, TX_R4]);
    expect(attempts).toEqual([{ url: CSIRO, reason: 'value-set-not-found' }]);
  });

  it('keeps an authoritative answer of the routed server without asking further', async () => {
    const { client, validateCodeAttempt } = apiClientAnswering({ [CSIRO]: 'invalid', [TX_R4]: 'valid' });

    await expect(request(client)).resolves.toBe('invalid');

    expect(validateCodeAttempt).toHaveBeenCalledTimes(1);
  });

  it('stays unverified once every server has been asked, naming each attempt', async () => {
    const { client, validateCodeAttempt } = apiClientAnswering({});
    const attempts: TerminologyServerAttempt[] = [];

    await expect(request(client, { attempts })).resolves.toBe('unverified');

    expect(validateCodeAttempt).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([
      { url: CSIRO, reason: 'value-set-not-found' },
      { url: TX_R4, reason: 'value-set-not-found' },
    ]);
  });

  it('retries each server with the package definition before moving on', async () => {
    const definition: ValueSet = {
      resourceType: 'ValueSet',
      url: VSAC_RACE,
      status: 'active',
      compose: { include: [{ system: CDC_RACE, concept: [{ code: '2106-3' }] }] },
    };
    const validateCodeAttempt = vi.fn()
      .mockResolvedValueOnce({ outcome: 'unverified', accepted: false, reason: 'value-set-not-found' })
      .mockResolvedValueOnce({ outcome: 'unverified', accepted: false, reason: 'value-set-not-found' })
      .mockResolvedValueOnce({ outcome: 'valid', accepted: true });
    const client = { validateCodeAttempt } as unknown as TerminologyApiClient;

    await expect(request(client, { packageLoader: packageLoaderWith(definition) })).resolves.toBe('valid');

    expect(validateCodeAttempt.mock.calls.map(call => [call[4]?.url, call[6] !== undefined]))
      .toEqual([[undefined, false], [undefined, true], [TX_R4, false]]);
  });
});

describe('code system operations delegation', () => {
  it('hands the release fallbacks to the value set check', async () => {
    const { client, validateCodeAttempt } = apiClientAnswering({ [CSIRO]: 'unverified', [TX_R4]: 'valid' });
    const operations = new ValueSetCodeSystemOperations({
      apiClient: client,
      cache: {} as unknown as ValueSetCache,
      getResolutionConfig: () => defaultConfig,
      packageLoader: packageLoaderWith(),
    });

    await expect(operations.validateViaServer({
      code: 'MA',
      system: 'https://www.usps.com/',
      valueSetUrl: 'http://terminology.hl7.org/ValueSet/USPS-State',
      bindingStrength: 'extensible',
      fhirVersion: 'R4',
    })).resolves.toBe('valid');

    expect(validateCodeAttempt.mock.calls.map(call => call[4]?.url)).toEqual([undefined, TX_R4]);
  });
});
