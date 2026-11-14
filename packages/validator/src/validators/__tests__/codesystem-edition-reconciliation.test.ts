import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from '../terminology-api-client.js';
import { validateCodeInCodeSystemWithFallbacks } from '../valueset-code-system-validator.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});
const system = 'http://snomed.info/sct', code = '123456';
const current = `${system}/900000000000207008/version/20261001`;
const older = `${system}/900000000000207008/version/20250201`;
const primary = 'https://primary.example/fhir', fallback = 'https://fallback.example/fhir', third = 'https://third.example/fhir';
const configuration = { strategy: 'server-first' as const, serverUrl: primary,
  servers: [primary, fallback, third].map((url, index) => ({ id: String(index), url, enabled: true,
    snomedEditions: ['900000000000207008'], fhirVersions: ['R4' as const] })) };
function response(kind: 'positive' | 'display' | 'code' | 'inactive' | 'missing', version?: string) {
  return { resourceType: 'Parameters', parameter: [
    { name: 'result', valueBoolean: kind === 'positive' || kind === 'inactive' },
    ...(version ? [{ name: 'version', valueString: version }] : []),
    ...(kind === 'inactive' ? [{ name: 'inactive', valueBoolean: true }] : []),
    ...(['display', 'missing'].includes(kind) ? [{ name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{
      severity: 'error', code: kind === 'missing' ? 'not-found' : 'invalid', details: {
        coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: kind === 'missing' ? 'not-found' : 'invalid-display' }],
        text: kind === 'missing' ? 'CodeSystem version not found' : "Wrong Display Name. Valid display is 'Current label'",
      },
    }] } }] : []),
  ] };
}
function run(requestedVersion?: string, display = 'Old label') {
  return validateCodeInCodeSystemWithFallbacks({ apiClient: new TerminologyApiClient(configuration),
    code, system, display, codeSystemVersion: requestedVersion, fhirVersion: 'R4', resolutionConfig: configuration });
}
beforeEach(() => { get.mockReset(); });

describe('CodeSystem reconciliation stays within the selected edition', () => {
  it.each(['display', 'code', 'inactive'] as const)('pins fallback requests after a %s response selects an edition', async kind => {
    get.mockResolvedValueOnce({ data: response(kind, current) })
      .mockResolvedValueOnce({ data: response('positive', older) })
      .mockResolvedValueOnce({ data: response('missing', current) });
    const result = await run();
    expect(result).toMatchObject({ codeSystemVersion: current, ...(kind === 'inactive' ? { inactive: true } : { valid: false }) });
    if (kind !== 'inactive') expect(result.reason).toBe(kind === 'display' ? 'display-mismatch' : 'code-unknown');
    expect(get).toHaveBeenNthCalledWith(2, fallback + '/CodeSystem/$validate-code', expect.objectContaining({ params: expect.objectContaining({ version: current }) }));
    expect(get).toHaveBeenNthCalledWith(3, third + '/CodeSystem/$validate-code', expect.objectContaining({ params: expect.objectContaining({ version: current }) }));
  });

  it.each(['display', 'code', 'inactive'] as const)('allows same-edition positive reconciliation for %s', async kind => {
    get.mockResolvedValueOnce({ data: response(kind, current) }).mockResolvedValueOnce({ data: response('positive', current) });
    const result = await run();
    expect(result).toMatchObject({ valid: true, codeSystemVersion: current });
    expect(result.inactive).not.toBe(true);
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps an explicit requested edition when the first provider returns a different release', async () => {
    get.mockResolvedValueOnce({ data: response('positive', current) }).mockResolvedValueOnce({ data: response('positive', older) });
    expect(await run(older)).toMatchObject({ valid: true, codeSystemVersion: older });
    expect(get).toHaveBeenNthCalledWith(2, fallback + '/CodeSystem/$validate-code', expect.objectContaining({ params: expect.objectContaining({ version: older }) }));
  });

  it.each(['display', 'code'] as const)('pins later fallbacks after a missing primary and a %s response', async kind => {
    get.mockResolvedValueOnce({ data: response('missing') }).mockResolvedValueOnce({ data: response(kind, current) })
      .mockResolvedValueOnce({ data: response('positive', older) });
    expect(await run()).toMatchObject({ valid: false, reason: kind === 'display' ? 'display-mismatch' : 'code-unknown', codeSystemVersion: current });
    expect(get).toHaveBeenNthCalledWith(3, third + '/CodeSystem/$validate-code', expect.objectContaining({ params: expect.objectContaining({ version: current }) }));
  });

  it('does not treat a missing definition echo as a selected default edition', async () => {
    get.mockResolvedValueOnce({ data: response('missing', current) }).mockResolvedValueOnce({ data: response('positive', older) });
    expect(await run()).toMatchObject({ valid: true, codeSystemVersion: older });
    expect(get.mock.calls[1][1].params.version).toBeUndefined();
  });

  it('retains requested and resolved versions in display diagnostics', async () => {
    get.mockResolvedValue({ data: response('display', current) });
    const result = await run(current);
    expect(buildCodeSystemResultIssues({ code, system, display: 'Old label', version: current }, result, 'Observation.code', 0, false))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch',
        details: expect.objectContaining({ codeSystemVersion: current, resolvedCodeSystemVersion: current }) }));
  });
});

describe('reported CodeSystem version is usable evidence', () => {
  it.each([
    ['wrong edition', [{ name: 'version', valueString: older }]],
    ['duplicate version', [{ name: 'version', valueString: current }, { name: 'version', valueString: current }]],
    ['conflicting versions', [{ name: 'version', valueString: current }, { name: 'version', valueString: older }]],
    ['wrong datatype', [{ name: 'version', valueUri: current }]],
    ['wrong runtime type', [{ name: 'version', valueString: 42 }]],
    ['empty version', [{ name: 'version', valueString: '' }]],
    ['multiple values', [{ name: 'version', valueString: current, valueCode: current }]],
    ['modified version', [{ name: 'version', valueString: current, modifierExtension: [{ url: 'https://example.test/rule' }] }]],
  ])('keeps %s unverified and retryable', async (_name, parameters) => {
    const api = new TerminologyApiClient(configuration);
    get.mockResolvedValueOnce({ data: { ...response('positive'), parameter: [...response('positive').parameter, ...parameters] } })
      .mockResolvedValueOnce({ data: response('positive', current) });
    const result = await api.validateCodeInCodeSystem(code, system, 'Current label', undefined, current);
    expect(result).toMatchObject({ valid: false, reason: 'server-failure' });
    expect(isVerifiedCodeSystemResult(result)).toBe(false);
    expect(await api.validateCodeInCodeSystem(code, system, 'Current label', undefined, current))
      .toMatchObject({ valid: true, codeSystemVersion: current });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('accepts a compliant R4 response without an optional returned version', async () => {
    get.mockResolvedValueOnce({ data: response('positive') });
    const result = await new TerminologyApiClient(configuration).validateCodeInCodeSystem(code, system, undefined, undefined, current);
    expect(result.valid).toBe(true);
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
  });
});
