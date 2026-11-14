import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from '../terminology-api-client.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});

const system = 'http://snomed.info/sct';
const code = '53741008';
const version = `${system}/900000000000207008/version/20260701`;
const valueSet = 'https://example.org/ValueSet/synthetic';
const positive = { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: true }] };
const outcome = (issue: unknown[]) => ({ resourceType: 'OperationOutcome', issue });
const client = () => new TerminologyApiClient({ strategy: 'server-first', serverUrl: 'https://synthetic.example/fhir' });
const broken = [
  ['HTML proxy error', '<html>Not found</html>'],
  ['no response body', null],
  ['empty outcome', outcome([])],
  ['malformed issue', outcome([null])],
  ['missing issue code', outcome([{ severity: 'error', diagnostics: 'Unknown code' }])],
  ['operation failure', outcome([{ severity: 'error', code: 'exception', diagnostics: 'Index unavailable' }])],
  ['request error', outcome([{ severity: 'error', code: 'invalid', diagnostics: 'Malformed request' }])],
  ['information only', outcome([{ severity: 'information', code: 'code-invalid' }])],
  ['modified outcome', { ...outcome([{ severity: 'error', code: 'code-invalid' }]),
    implicitRules: 'https://example.org/unknown' }],
  ['modified issue', outcome([{ severity: 'error', code: 'code-invalid',
    modifierExtension: [{ url: 'https://example.org/unknown' }] }])],
  ['malformed sibling', outcome([{ severity: 'error', code: 'code-invalid' }, null])],
  ['untyped display claim', outcome([{ severity: 'error', code: 'invalid-display' }])],
  ['conflicting issue codes', outcome([{ severity: 'error', code: 'invalid', details: { coding: [
    { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' },
    { system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'code-comment' },
  ] } }])],
] as const;

describe('terminology transport responses cannot invent code authority', () => {
  beforeEach(() => { get.mockReset(); });

  describe.each([404, 422])('HTTP %s', status => {
    it.each(broken)('reports %s as a retryable execution failure in both operations', async (_name, body) => {
      const error = { isAxiosError: true, response: { status, data: body } };
      const api = client();
      get.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: positive })
        .mockRejectedValueOnce(error).mockResolvedValueOnce({ data: positive });
      const cs = await api.validateCodeInCodeSystem(code, system, undefined, undefined, version);
      expect(cs).toMatchObject({ valid: false, reason: 'server-failure' });
      expect(buildCodeSystemResultIssues({ code, system, version }, cs, 'Observation.code.coding', 0, true))
        .toEqual([expect.objectContaining({ code: 'terminology-server-failure', severity: 'warning',
          details: expect.objectContaining({ validationComplete: false, checkOutcome: 'execution-failure' }),
        })]);
      expect(await api.validateCodeInCodeSystem(code, system, undefined, undefined, version))
        .toMatchObject({ valid: true });
      expect(await api.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
        .toMatchObject({ accepted: false, outcome: 'unverified', reason: 'server-failure' });
      expect(api.isValueSetNotResolvable(valueSet, undefined, system, version)).toBe(false);
      expect(await api.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
        .toMatchObject({ accepted: true, outcome: 'valid' });
      expect(get).toHaveBeenCalledTimes(4);
    });

    it('preserves a typed code rejection and an explicit missing definition separately', async () => {
      get.mockRejectedValue({ isAxiosError: true, response: { status,
        data: outcome([{ severity: 'error', code: 'code-invalid', diagnostics: 'Code rejected in requested edition' }]),
      } });
      const api = client();
      expect(await api.validateCodeInCodeSystem(code, system, undefined, undefined, version))
        .toMatchObject({ valid: false, reason: 'code-unknown' });
      expect(await api.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
        .toMatchObject({ accepted: false, outcome: 'invalid' });
      get.mockRejectedValue({ isAxiosError: true, response: { status,
        data: outcome([{ severity: 'error', code: 'not-found', diagnostics: 'CodeSystem could not be found' }]),
      } });
      const unavailable = client();
      expect(await unavailable.validateCodeInCodeSystem(code, system, undefined, undefined, version))
        .toMatchObject({ valid: false, reason: 'system-unresolvable' });
      expect(await unavailable.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
        .toMatchObject({ outcome: 'unverified', reason: 'value-set-not-found' });
    });
  });

  it('does not cache an ambiguous HTTP 200 or misdiagnose a missing definition', async () => {
    const ambiguous = { resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: true }, { name: 'result', valueBoolean: false },
    ] };
    get.mockResolvedValueOnce({ data: ambiguous }).mockResolvedValueOnce({ data: positive })
      .mockResolvedValueOnce({ data: ambiguous }).mockResolvedValueOnce({ data: positive });
    const api = client();
    expect(await api.validateCodeInCodeSystem(code, system, undefined, undefined, version))
      .toMatchObject({ valid: false, reason: 'server-failure' });
    expect(await api.validateCodeInCodeSystem(code, system, undefined, undefined, version))
      .toMatchObject({ valid: true });
    expect(await api.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
      .toMatchObject({ outcome: 'unverified', reason: 'server-failure' });
    expect(await api.validateCodeAttempt(code, system, valueSet, 'required', undefined, version))
      .toMatchObject({ outcome: 'valid' });
    expect(get).toHaveBeenCalledTimes(4);
  });
});
