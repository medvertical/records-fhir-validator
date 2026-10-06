import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { TerminologyApiClient } from '../terminology-api-client';
import { ValueSetCodeSystemOperations } from '../valueset-code-system-operations';
import { ValueSetCache } from '../valueset-cache';
import type { TerminologyResolutionConfig } from '../valueset-types';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../../core/semantic-aspect-plan';

const system = 'http://snomed.info/sct';
const edition = 'http://snomed.info/sct/900000000000207008/version/20230731';
const configs: TerminologyResolutionConfig[] = ['local-only', 'server-first'].map(strategy => ({
  strategy: strategy as 'local-only' | 'server-first', serverUrl: 'https://tx.example.test/fhir',
  serverDelegation: { validateCodes: false, expandValueSets: false, cacheResults: true, cacheTTLSeconds: 3600 },
}));

function operations(config: TerminologyResolutionConfig, cache = new ValueSetCache()) {
  const remote = vi.fn();
  const instance = new ValueSetCodeSystemOperations({
    cache, apiClient: { validateCodeInCodeSystem: remote } as never,
    getResolutionConfig: () => config, packageLoader: { loadCodeSystem: vi.fn(async () => null) } as never,
  });
  return { instance, remote, cache };
}

describe('explicitly disabled CodeSystem evidence', () => {
  it.each(configs)('direct API retains acceptance but attests the skip under $strategy', async config => {
    const client = new TerminologyApiClient(config);
    for (const version of [undefined, edition]) {
      const cold = await client.validateCodeInCodeSystem('100005', system, undefined, undefined, version);
      const warm = await client.validateCodeInCodeSystem('100005', system, undefined, undefined, version);
      expect(cold).toMatchObject({ valid: true, reason: 'delegation-disabled' });
      expect(warm).toEqual(cold);
    }
  });

  it.each(configs)('high-level API keeps disabled $strategy unknown', async config => {
    const { instance, remote, cache } = operations(config);
    for (const version of [undefined, edition]) {
      const cold = await instance.validate('100005', system, undefined, 'R4', version);
      expect(cold).toMatchObject({ valid: true, reason: 'delegation-disabled' });
      expect(await instance.validate('100005', system, undefined, 'R4', version)).toEqual(cold);
      cache.clear();
      expect(await instance.validate('100005', system, undefined, 'R4', version)).toEqual(cold);
    }
    expect(remote).not.toHaveBeenCalled();
  });

  it.each(['2.0.0', '2.0.1'])('does not discard complete local evidence version %s', async version => {
    const { instance, remote, cache } = operations(configs[0]);
    const localSystem = 'http://example.test/CodeSystem/complete';
    const resource = { resourceType: 'CodeSystem' as const, url: localSystem, version,
      content: 'complete' as const, concept: [{ code: 'known' }] };
    cache.setCodeSystem(`${localSystem}|${version}`, resource);
    expect(await instance.validate('known', localSystem, undefined, undefined, version)).toMatchObject({ valid: true });
    expect(await instance.validate('known', localSystem, undefined, undefined, version)).not.toHaveProperty('reason');
    expect(await instance.validate('missing', localSystem, undefined, undefined, version)).toMatchObject({ valid: false, reason: 'code-unknown' });
    expect(remote).not.toHaveBeenCalled();
  });

  it.each([undefined, edition])('maps skipped evidence separately from invalidity with version %s', version => {
    const issues = buildCodeSystemResultIssues({ code: '100005', system, version },
      { valid: true, reason: 'delegation-disabled' }, 'Observation.code.coding', 0, true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'terminology-codesystem-unverified', severity: 'information',
      path: 'Observation.code.coding[0].code', details: { reason: 'delegation-disabled', validationComplete: false, validationStatus: 'incomplete' } });
    expect(issues.some(issue => issue.severity === 'error' || issue.code === 'terminology-code-invalid')).toBe(false);
    if (version) expect(issues[0].details).toHaveProperty('codeSystemVersion', version);
    const suppressed = { ...issues[0], rawSeverity: 'information' as const, disposition: 'suppressed' as const };
    const result = projectSemanticAspectResult({ isValid: true,
      structureDef: { resourceType: 'StructureDefinition' } as unknown as StructureDefinition,
      aspects: [{ aspect: 'terminology', isValid: true, issues: [], evidenceIssues: [suppressed], validationTime: 0 }],
    }, resolveSemanticAspectPlan(['terminology']));
    expect(result.isValid).toBe(false);
    expect(result.aspects[0].evidenceIssues?.[0]).toMatchObject({ rawSeverity: 'information', details: { validationComplete: false } });
  });

  it('does not cache the disabled skip as a later enabled authoritative result', async () => {
    let config = configs[0];
    const remote = vi.fn(async () => ({ valid: false, reason: 'code-unknown' as const }));
    const instance = new ValueSetCodeSystemOperations({ cache: new ValueSetCache(),
      apiClient: { validateCodeInCodeSystem: remote } as never, getResolutionConfig: () => config,
      packageLoader: { loadCodeSystem: vi.fn(async () => null) } as never });
    expect(await instance.validate('unknown', 'http://loinc.org')).toMatchObject({ valid: true, reason: 'delegation-disabled' });
    config = { ...config, strategy: 'server-first', serverDelegation: { ...config.serverDelegation!, validateCodes: true } };
    expect(await instance.validate('unknown', 'http://loinc.org')).toMatchObject({ valid: false, reason: 'code-unknown' });
    expect(remote).toHaveBeenCalledOnce();
  });
});
