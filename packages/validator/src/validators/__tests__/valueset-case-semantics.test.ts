import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { conceptFilterMembership } from '../valueset-concept-filter-membership.js';
import { assessFiniteCodeSystem, expandFiniteValueSet } from '../finite-valueset-expansion.js';
import type { CodeSystem, ValueSet, ValueSetComposeInclude } from '../valueset-types.js';
import { validateValueSetMembership } from '../valueset-membership-validator.js';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics.js';

const system = 'https://example.test/CodeSystem/MixedCase';
const url = 'https://example.test/ValueSet/case-policy';
const codeSystem = (caseSensitive?: boolean, version = '1'): CodeSystem => ({ resourceType: 'CodeSystem', url: system,
  version, caseSensitive, content: 'complete', count: 3, hierarchyMeaning: 'is-a',
  concept: [{ code: 'root', concept: [{ code: 'alpha' }] }, { code: 'other' }] });
const valueSet = (include: ValueSetComposeInclude[], exclude?: ValueSetComposeInclude[]): ValueSet => ({
  resourceType: 'ValueSet', url, version: '1', status: 'active', compose: { include, exclude },
});
afterEach(() => vi.restoreAllMocks());
function validator(cs: CodeSystem | null, vs: ValueSet) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
    serverDelegation: { validateCodes: false, expandValueSets: false } });
  if (cs) expect(values.registerExternalTerminologyResource(cs, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource(vs, 'R4')).toBe(true);
  return values;
}
const resolve = (values: ValueSetValidator, code: string, version?: string, codingSystem = system) =>
  values.resolveCodeBindingForBinding(code, codingSystem, url, 'required', 'R4', 'Observation.code', version);

describe('CodeSystem case semantics through public binding and membership operations', () => {
  it.each([false, undefined, true])('qualifies whole-system membership using caseSensitive=%s', async sensitive => {
    const values = validator(codeSystem(sensitive), valueSet([{ system }]));
    for (let round = 0; round < 2; round++) {
      await expect(resolve(values, 'alpha')).resolves.toBe('valid');
      await expect(resolve(values, 'ALPHA')).resolves.toBe(sensitive ? 'invalid' : 'valid');
      await expect(resolve(values, 'not-a-code')).resolves.toBe('invalid');
      await expect(values.isCodeInValueSet('ALPHA', system, url, 'R4')).resolves.toBe(!sensitive);
    }
  });
  it.each([false, undefined, true])('handles explicit include/exclude spellings using caseSensitive=%s', async sensitive => {
    const values = validator(codeSystem(sensitive), valueSet([{ system, concept: [{ code: 'alpha' }, { code: 'other' }] }],
      [{ system, concept: [{ code: 'ALPHA' }] }]));
    await expect(resolve(values, 'alpha')).resolves.toBe(sensitive ? 'valid' : 'invalid');
    await expect(resolve(values, 'ALPHA')).resolves.toBe('invalid');
    await expect(resolve(values, 'other')).resolves.toBe('valid');
    await expect(resolve(values, 'not-a-code')).resolves.toBe('invalid');
  });
  it.each([false, undefined, true])('honors hierarchy input and root casing using caseSensitive=%s', async sensitive => {
    const cs = codeSystem(sensitive);
    expect(conceptFilterMembership(cs, 'ALPHA', { property: 'concept', op: 'is-a', value: 'ROOT' }))
      .toBe(sensitive ? null : true);
    expect(conceptFilterMembership(cs, 'other', { property: 'concept', op: 'is-a', value: 'root' })).toBe(false);
    const values = validator(cs, valueSet([{ system, filter: [{ property: 'concept', op: 'is-a', value: 'ROOT' }] }]));
    await expect(resolve(values, 'ALPHA')).resolves.toBe(sensitive ? 'unverified' : 'valid');
    await expect(resolve(values, 'other')).resolves.toBe(sensitive ? 'unverified' : 'invalid');
  });
  it.each([false, undefined, true])('resolves explicit Coding.version using caseSensitive=%s', async sensitive => {
    const values = validator(codeSystem(sensitive), valueSet([{ system, version: '1', concept: [{ code: 'ALPHA' }] }]));
    await expect(resolve(values, 'alpha', '1')).resolves.toBe(sensitive ? 'invalid' : 'valid');
    await expect(resolve(values, 'ALPHA', '1')).resolves.toBe(sensitive ? 'invalid' : 'valid');
    await expect(resolve(values, 'alpha', '2')).resolves.toBe('unverified');
  });
  it.each([false, undefined, true])('handles stored expansions without changing system URI case (%s)', async sensitive => {
    const vs: ValueSet = { resourceType: 'ValueSet', url, status: 'active', expansion: {
      total: 1, contains: [{ system, version: '1', code: 'alpha' }],
    } };
    const values = validator(codeSystem(sensitive), vs);
    await expect(resolve(values, 'ALPHA')).resolves.toBe(sensitive ? 'invalid' : 'valid');
    await expect(resolve(values, 'not-a-code')).resolves.toBe('invalid');
    await expect(resolve(values, 'ALPHA', undefined, system.toLowerCase())).resolves.toBe('invalid');
  });
  it('retains an unavailable case policy as unverified for a possible spelling variant', async () => {
    const values = validator(null, valueSet([{ system, concept: [{ code: 'alpha' }] }]));
    await expect(resolve(values, 'alpha')).resolves.toBe('valid');
    await expect(resolve(values, 'ALPHA')).resolves.toBe('unverified');
    await expect(resolve(values, 'different-code')).resolves.toBe('invalid');
  });
  it('keeps alternative editions and their exclusions separate', async () => {
    const values = validator(codeSystem(false), valueSet([{ system, version: '1' }, { system, version: '2' }],
      [{ system, version: '1', concept: [{ code: 'ALPHA' }] }]));
    values.registerExternalTerminologyResource(codeSystem(true, '2'), 'R4');
    await expect(resolve(values, 'alpha')).resolves.toBe('valid');
    await expect(resolve(values, 'ALPHA')).resolves.toBe('invalid');
  });
  it('does not enforce a case-sensitive flat-index miss over a qualified insensitive expansion', async () => {
    const cs = codeSystem(false), vs: ValueSet = { resourceType: 'ValueSet', url, status: 'active',
      expansion: { total: 1, contains: [{ system, code: 'alpha' }] } };
    const diagnostics = createEmptyTerminologyDiagnostics();
    const remote = vi.fn();
    await expect(validateValueSetMembership({ apiClient: { validateCodeAttempt: remote } as never,
      getExpandedValueSet: async () => new Set([`${system}|alpha`]),
      packageLoader: { loadValueSetResource: async () => vs, loadCodeSystemForValueSet: async () => cs,
        getIncludeConceptFilters: async () => [], hasIncompleteExpansion: async () => false } as never,
      resolutionConfig: { strategy: 'local-only' }, terminologyDiagnostics: diagnostics,
      twoPhaseShadow: { lookup: async () => null, getEnforcedResult: () => false,
        finish: (_lookup: unknown, result: boolean) => result } as never,
    }, 'ALPHA', system, url, 'R4')).resolves.toBe(true);
    expect(diagnostics.failOpenMembershipChecks.total).toBe(0);
    expect(remote).not.toHaveBeenCalled();
  });
  it('qualifies finite compose exclusions and intersections before claiming completeness', async () => {
    const cs = codeSystem(false);
    const resolver = { codeSystem: async () => cs, valueSet: async () => null };
    const result = await expandFiniteValueSet(valueSet([{ system, concept: [{ code: 'alpha' }, { code: 'other' }] }],
      [{ system, concept: [{ code: 'ALPHA' }] }]), resolver);
    expect(result.coverage).toBe('complete');
    expect(result.concepts.map(c => c.code)).toEqual(['other']);
    expect(assessFiniteCodeSystem({ ...cs, count: 2, concept: [{ code: 'alpha' }, { code: 'ALPHA' }] }).coverage).toBe('partial');
  });
});
