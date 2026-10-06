import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from '../terminology-api-client';
import { ValueSetCache } from '../valueset-cache';
import type { TerminologyResolutionConfig } from '../valueset-types';

const config = (validateCodes: boolean): TerminologyResolutionConfig => ({
  strategy: validateCodes ? 'server-first' : 'local-only', serverUrl: 'https://tx.example.test/fhir',
  serverDelegation: { expandValueSets: false, validateCodes, cacheResults: true, cacheTTLSeconds: 3600 },
});
const response = { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: false }] };
const get = vi.hoisted(() => vi.fn());
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});
beforeEach(() => get.mockReset().mockResolvedValue({ data: response }));

describe('disabled CodeSystem validation cache contract', () => {
  it('does not poison authoritative cache across disabled enabled disabled transitions', async () => {
    const client = new TerminologyApiClient(config(false));
    expect(await client.validateCodeInCodeSystem('synthetic-missing', 'http://loinc.org')).toMatchObject({ valid: true, reason: 'delegation-disabled' });
    expect(get).not.toHaveBeenCalled();
    client.setConfig(config(true));
    expect(await client.validateCodeInCodeSystem('synthetic-missing', 'http://loinc.org')).toMatchObject({ valid: false, reason: 'code-unknown' });
    expect(get).toHaveBeenCalledOnce();
    client.setConfig(config(false));
    expect(await client.validateCodeInCodeSystem('synthetic-missing', 'http://loinc.org')).toMatchObject({ valid: true, reason: 'delegation-disabled' });
    client.setConfig(config(true));
    expect(await client.validateCodeInCodeSystem('synthetic-missing', 'http://loinc.org')).toMatchObject({ valid: false, reason: 'code-unknown' });
    expect(get).toHaveBeenCalledOnce();
  });

  it('keeps real source scopes and requested versions isolated when validation resumes', async () => {
    const cache = new ValueSetCache(), client = new TerminologyApiClient(config(false), cache);
    const a = { organizationId: 11, serverId: 21, fhirVersion: 'R4' as const };
    const b = { organizationId: 12, serverId: 22, fhirVersion: 'R4' as const };
    const call = (scope: typeof a, version: string) => cache.sourceContexts.runWith(scope,
      () => client.validateCodeInCodeSystem('synthetic-missing', 'http://loinc.org', undefined, undefined, version));
    for (const scope of [a, b]) for (const version of ['2.0.0', '2.0.1']) {
      expect(await call(scope, version)).toMatchObject({ valid: true, reason: 'delegation-disabled' });
    }
    expect(get).not.toHaveBeenCalled();
    client.setConfig(config(true));
    for (const scope of [a, b]) for (const version of ['2.0.0', '2.0.1']) {
      expect(await call(scope, version)).toMatchObject({ valid: false, reason: 'code-unknown' });
      expect(await call(scope, version)).toMatchObject({ valid: false, reason: 'code-unknown' });
    }
    expect(get).toHaveBeenCalledTimes(4);
  });
});
