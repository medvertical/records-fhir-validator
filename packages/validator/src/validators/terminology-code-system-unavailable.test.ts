import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from './terminology-api-client';
import { ValueSetValidator } from './valueset-validator';
import { isVerifiedCodeSystemResult } from './code-system-validation-evidence';
import { buildCodeSystemResultIssues } from '../core/executors/terminology-code-system-result-issues';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});

const system = 'http://snomed.info/sct';
const version = 'http://snomed.info/sct/900000000000207008/version/20260701';

describe('unavailable CodeSystem validation', () => {
  beforeEach(() => { get.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports a missing server without making a request', async () => {
    const client = new TerminologyApiClient({ strategy: 'server-first' });
    const result = await client.validateCodeInCodeSystem('53741008', system, undefined, undefined, version);
    expect(result).toMatchObject({ valid: true, reason: 'no-server' });
    expect(isVerifiedCodeSystemResult(result)).toBe(false);
    expect(buildCodeSystemResultIssues(
      { code: '53741008', system, version }, result, 'Observation.code.coding', 0, true,
    )).toEqual([expect.objectContaining({
      code: 'terminology-codesystem-unverified', severity: 'information',
      path: 'Observation.code.coding[0].code',
      details: expect.objectContaining({
        reason: 'no-server', validationComplete: false, validationStatus: 'incomplete',
        codeSystemVersion: version,
      }),
    })]);
    expect(get).not.toHaveBeenCalled();
  });

  it('reports timeouts and open circuits rather than successful validation', async () => {
    get.mockRejectedValue(new Error('timeout'));
    const client = new TerminologyApiClient({ strategy: 'server-first', serverUrl: 'https://timeouts.example/fhir' });
    for (const code of ['A', 'B', 'C']) {
      const result = await client.validateCodeInCodeSystem(code, system, undefined, undefined, version);
      expect(result).toMatchObject({ valid: false, reason: 'server-failure' });
      expect(isVerifiedCodeSystemResult(result)).toBe(false);
      expect(buildCodeSystemResultIssues(
        { code, system, version }, result, 'Observation.code.coding', 0, true,
      )).toEqual([expect.objectContaining({
        code: 'terminology-server-failure', severity: 'warning',
        path: 'Observation.code.coding[0].system',
        details: expect.objectContaining({
          reason: 'server-failure', checkOutcome: 'execution-failure', codeSystemVersion: version,
        }),
      })]);
    }
    const skipped = await client.validateCodeInCodeSystem('D', system, undefined, undefined, version);
    expect(skipped).toMatchObject({ valid: true, reason: 'circuit-open' });
    expect(isVerifiedCodeSystemResult(skipped)).toBe(false);
    expect(buildCodeSystemResultIssues(
      { code: 'D', system, version }, skipped, 'Observation.code.coding', 0, true,
    )).toEqual([expect.objectContaining({
      code: 'terminology-codesystem-unverified', severity: 'information',
      path: 'Observation.code.coding[0].code',
      details: expect.objectContaining({
        reason: 'circuit-open', validationComplete: false, validationStatus: 'incomplete',
        codeSystemVersion: version,
      }),
    })]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.every(([, config]) => config.params.version === version)).toBe(true);
  });

  it('does not cache a transient failure as a passing result', async () => {
    get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce({ data: { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: true }] } });
    const client = new TerminologyApiClient({ strategy: 'server-first', serverUrl: 'https://retry.example/fhir' });
    const failed = await client.validateCodeInCodeSystem('53741008', system, undefined, undefined, version);
    expect(failed).toMatchObject({ valid: false, reason: 'server-failure' });
    expect(isVerifiedCodeSystemResult(failed)).toBe(false);
    const recovered = await client.validateCodeInCodeSystem('53741008', system, undefined, undefined, version);
    expect(recovered).toMatchObject({ valid: true });
    expect(isVerifiedCodeSystemResult(recovered)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      params: expect.objectContaining({ version }),
    }));
  });

  it('tries only configured fallback servers without dropping the requested edition', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({ strategy: 'server-first', serverUrl: 'https://primary.example/fhir', servers: [
      { id: 'primary', url: 'https://primary.example/fhir', enabled: true, fhirVersions: ['R4'], snomedEditions: ['900000000000207008'] },
      { id: 'fallback', url: 'https://fallback.example/fhir', enabled: true, fhirVersions: ['R4'], snomedEditions: ['900000000000207008'] },
    ] });
    get.mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: true }] } });
    const recovered = await validator.validateCodeInCodeSystem('53741008', system, undefined, 'R4', version);
    expect(recovered).toMatchObject({ valid: true });
    expect(isVerifiedCodeSystemResult(recovered)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(2, 'https://fallback.example/fhir/CodeSystem/$validate-code', expect.objectContaining({
      params: expect.objectContaining({ version }),
    }));
  });
});
