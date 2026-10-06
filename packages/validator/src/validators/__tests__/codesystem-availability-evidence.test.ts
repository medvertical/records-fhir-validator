import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminologyApiClient } from '../terminology-api-client.js';
import { TerminologyCircuitBreakerRegistry } from '../terminology-circuit-breakers.js';
import { TerminologyOperationCache } from '../terminology-operation-cache.js';
import { getTerminologyServerScope } from '../terminology-server-scope.js';
import { ValueSetCodeSystemOperations } from '../valueset-code-system-operations.js';
import { ValueSetCache } from '../valueset-cache.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import type { TerminologyResolutionConfig } from '../valueset-types.js';

const get = vi.hoisted(() => vi.fn());
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});
beforeEach(() => get.mockReset());

const system = 'http://loinc.org', code = '11369-6', url = 'https://tx.example.test/fhir';
const config: TerminologyResolutionConfig = { strategy: 'server-first',
  serverDelegation: { validateCodes: true, expandValueSets: false, cacheResults: true, cacheTTLSeconds: 60 } };
const coding = { system, code, version: '2.0.0' };

describe('unavailable CodeSystem evidence remains explicitly undecided', () => {
  it('preserves compatibility acceptance with incomplete evidence when no server is configured', async () => {
    const client = new TerminologyApiClient(config);
    const result = await client.validateCodeInCodeSystem(code, system, undefined, undefined, coding.version);
    expect(result).toMatchObject({ valid: true, reason: 'no-server' });
    const issues = buildCodeSystemResultIssues(coding, result, 'Observation.code.coding', 0, true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'information', code: 'terminology-codesystem-unverified',
      details: { reason: 'no-server', validationComplete: false, codeSystemVersion: '2.0.0' } });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not cache an open circuit as recovered membership=%s', async answer => {
    const breakers = new TerminologyCircuitBreakerRegistry();
    const breaker = breakers.get('codesystem-validate-code', getTerminologyServerScope(url, undefined));
    for (let n = 0; n < 3; n++) breaker.recordFailure();
    const client = new TerminologyApiClient({ ...config, serverUrl: url },
      new ValueSetCache(), new TerminologyOperationCache(), breakers);
    const call = () => client.validateCodeInCodeSystem(code, system, undefined, undefined, coding.version);
    const initial = await call();
    expect(initial).toMatchObject({ valid: true, reason: 'circuit-open' });
    expect(buildCodeSystemResultIssues(coding, initial, 'Observation.code', 0, false)[0])
      .toMatchObject({ severity: 'information', details: { validationComplete: false } });
    expect(get).not.toHaveBeenCalled();
    breaker.reset();
    get.mockResolvedValue({ data: { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: answer }] } });
    const recovered = await call();
    expect(recovered.valid).toBe(answer);
    expect(recovered.reason).toBe(answer ? undefined : 'code-unknown');
    expect(await call()).toEqual(recovered);
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([
    { enabled: false, circuitOpen: false, fhirVersions: ['R4' as const] },
    { enabled: true, circuitOpen: true, fhirVersions: ['R4' as const] },
    { enabled: true, circuitOpen: false, fhirVersions: ['R5' as const] },
  ])('reports a selected-source skip when the configured descriptor is ineligible: %j', async descriptor => {
    const remote = vi.fn();
    const instance = new ValueSetCodeSystemOperations({ cache: new ValueSetCache(),
      apiClient: { validateCodeInCodeSystem: remote } as never,
      packageLoader: { loadCodeSystem: vi.fn(async () => null) } as never,
      getResolutionConfig: () => ({ ...config, serverUrl: url,
        servers: [{ id: 'selected', url, preferredSystems: [system], ...descriptor }] }) });
    expect(await instance.validate(code, system, undefined, 'R4', coding.version))
      .toMatchObject({ valid: true, reason: 'no-server' });
    expect(remote).not.toHaveBeenCalled();
  });

  it.each(['no-server', 'circuit-open'] as const)('does not turn %s into an invalid-code error', reason => {
    const issues = buildCodeSystemResultIssues(coding, { valid: true, reason }, 'Observation.code.coding', 0, true);
    expect(issues.every(issue => issue.severity === 'information')).toBe(true);
    expect(issues.some(issue => issue.code === 'terminology-code-invalid')).toBe(false);
    expect(issues[0].details).toMatchObject({ reason, validationComplete: false });
  });

  it('preserves a known invalid code beside separate unavailable evidence', () => {
    const unknown = buildCodeSystemResultIssues(coding, { valid: true, reason: 'no-server' }, 'Observation.code.coding', 0, true);
    const invalid = buildCodeSystemResultIssues({ ...coding, code: 'missing' },
      { valid: false, reason: 'code-unknown' }, 'Observation.code.coding', 1, true);
    expect(unknown).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ severity: 'error', code: 'terminology-code-invalid',
      path: 'Observation.code.coding[1].code' });
  });
});
