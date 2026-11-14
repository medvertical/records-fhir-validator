import { describe, expect, it } from 'vitest';
import { expandFiniteValueSet, type FiniteTerminologyResolver } from '../finite-valueset-expansion.js';
import type { CodeSystem, ValueSet } from '../valueset-types.js';

const system = 'https://example.test/annual-codes', url = 'https://example.test/all-editions';
function fixture() {
  const systems: CodeSystem[] = ['2018', '2026'].map(version => ({ resourceType: 'CodeSystem', url: system,
    version, content: 'complete', caseSensitive: true, hierarchyMeaning: 'is-a', count: 2,
    concept: [{ code: 'COMMON', concept: [{ code: version === '2018' ? 'OLD' : 'NEW' }] }] }));
  const vs: ValueSet = { resourceType: 'ValueSet', url, compose: { include: [{ system, version: '*' }] } };
  const requested: Array<string | undefined> = [];
  const resolver: FiniteTerminologyResolver = {
    valueSet: async () => null, codeSystemVersions: async () => ['2018', '2026'],
    codeSystem: async (_canonical, version) => {
      requested.push(version);
      return systems.find(cs => cs.version === (version ?? '2026')) ?? null;
    },
  };
  return { systems, vs, resolver, requested };
}

describe('finite ValueSet all-version composition', () => {
  it('preserves historical and current editions instead of selecting the default', async () => {
    const { vs, resolver, requested } = fixture();
    expect(await expandFiniteValueSet(vs, resolver)).toMatchObject({ coverage: 'complete', reasons: [], concepts: [
      { system, version: '2018', code: 'COMMON' }, { system, version: '2018', code: 'OLD' },
      { system, version: '2026', code: 'COMMON' }, { system, version: '2026', code: 'NEW' },
    ] });
    expect(requested).toEqual(['2018', '2026']);
  });
  it.each([undefined, null, [], ['*'], [''], ['2018|2026'], Array.from({ length: 257 }, (_, i) => String(i))])(
    'does not substitute the default when the supported edition scope is unavailable (%j)', async versions => {
      const { vs, resolver, requested } = fixture();
      resolver.codeSystemVersions = versions === undefined ? undefined : async () => versions;
      expect(await expandFiniteValueSet(vs, resolver)).toMatchObject({ coverage: 'partial', concepts: [],
        reasons: [`codesystem-supported-versions-unavailable:${system}`] });
      expect(requested).toEqual([]);
    });
  it.each(['missing', 'wrong-edition', 'fragment', 'grammar', 'count', 'modifier'])('keeps %s editions partial', async mode => {
    const { vs, resolver, systems } = fixture();
    if (mode === 'missing') systems.pop();
    else if (mode === 'wrong-edition') systems[1].version = '2027';
    else if (mode === 'fragment') systems[1].content = 'fragment';
    else if (mode === 'grammar') systems[1].compositional = true;
    else if (mode === 'count') systems[1].count = 3;
    else Object.assign(systems[1], { modifierExtension: [{ url: 'https://example.test/unknown' }] });
    expect((await expandFiniteValueSet(vs, resolver)).coverage).toBe('partial');
  });
  it('applies filters in each edition and retains edition-specific exclusions', async () => {
    const { vs, resolver } = fixture();
    vs.compose!.include[0].filter = [{ property: 'concept', op: 'descendent-of', value: 'COMMON' }];
    vs.compose!.exclude = [{ system, version: '2026', concept: [{ code: 'NEW' }] }];
    expect(await expandFiniteValueSet(vs, resolver)).toMatchObject({ coverage: 'complete',
      concepts: [{ system, version: '2018', code: 'OLD' }] });
  });
  it('intersects nested sets per edition and excludes across all supported editions', async () => {
    const { vs, resolver } = fixture();
    vs.compose!.include[0].valueSet = ['https://example.test/nested'];
    resolver.valueSet = async () => ({ resourceType: 'ValueSet', url: 'https://example.test/nested',
      compose: { include: [{ system, concept: [{ code: 'COMMON' }, { code: 'OLD' }] }] } });
    vs.compose!.exclude = [{ system, version: '*', concept: [{ code: 'COMMON' }] }];
    expect(await expandFiniteValueSet(vs, resolver)).toMatchObject({ coverage: 'complete',
      concepts: [{ system, version: '2018', code: 'OLD' }] });
  });
  it('enforces the combined materialization budget', async () => {
    const { vs, resolver } = fixture();
    const result = await expandFiniteValueSet(vs, resolver, 3);
    expect(result).toMatchObject({ coverage: 'partial', reasons: ['expansion-size-limit'] });
    expect(result.concepts).toHaveLength(3);
  });
});
