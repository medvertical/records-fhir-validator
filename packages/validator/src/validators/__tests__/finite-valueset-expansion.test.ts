import { describe, expect, it } from 'vitest';
import { assessStoredExpansion, assessFiniteCodeSystem, expandFiniteValueSet, type FiniteTerminologyResolver } from '../finite-valueset-expansion.js';
import type { ValueSet, CodeSystem } from '../valueset-types.js';
import { conceptFilterMembership } from '../valueset-concept-filter-membership.js';

const system = 'https://example.test/codes';
const valueSet = (update: Partial<ValueSet>): ValueSet => ({ resourceType: 'ValueSet', url: 'https://example.test/vs', status: 'active', ...update });
const resolver = (sets: Record<string, ValueSet> = {}, systems: Record<string, CodeSystem> = {}): FiniteTerminologyResolver => ({
  valueSet: async url => sets[url] ?? null, codeSystem: async url => systems[url] ?? null,
});

describe('finite terminology coverage', () => {
  it('expands the declared ISO alpha-3 code filter without evaluating arbitrary regular expressions', async () => {
    const iso = 'urn:iso:std:iso:3166';
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: iso, content: 'complete', caseSensitive: true,
      count: 3, concept: [{ code: 'DE' }, { code: 'DEU' }, { code: '276' }] };
    const vs = valueSet({ compose: { include: [{ system: iso, filter: [{ property: 'code', op: 'regex', value: '[A-Z]{3}' }] }] } });
    expect(await expandFiniteValueSet(vs, resolver({}, { [iso]: cs }))).toMatchObject({ coverage: 'complete', concepts: [{ system: iso, code: 'DEU' }] });
    expect(conceptFilterMembership(cs, 'ZZZ', vs.compose!.include[0].filter![0])).toBeNull();
    expect(conceptFilterMembership(cs, 'DE', vs.compose!.include[0].filter![0])).toBe(false);
    vs.compose!.include[0].filter![0].value = '(a+)+$';
    expect(await expandFiniteValueSet(vs, resolver({}, { [iso]: cs }))).toMatchObject({ coverage: 'partial', reasons: ['unsupported-filter'] });
  });
  it('does not mistake a named unit inventory for a complete grammar, while preserving explicit finite subsets', async () => {
    const ucum = 'http://unitsofmeasure.org';
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: ucum, content: 'complete', count: 1, concept: [{ code: 'kg' }] };
    expect(assessFiniteCodeSystem(cs)).toMatchObject({ coverage: 'partial', reasons: ['codesystem-grammar-not-enumerable'] });
    expect(assessFiniteCodeSystem({ ...cs, url: system, compositional: true }).coverage).toBe('partial');
    const expanded = valueSet({ compose: { include: [{ system: ucum }] },
      expansion: { total: 1, contains: [{ system: ucum, code: 'kg' }] } });
    expect(await expandFiniteValueSet(expanded, resolver({}, { [ucum]: cs }))).toMatchObject({ coverage: 'partial' });
    expanded.compose!.include = [{ system: ucum, concept: [{ code: 'kg' }] }];
    expect(await expandFiniteValueSet(expanded, resolver({}, { [ucum]: cs }))).toMatchObject({ coverage: 'complete' });
  });
  it('rejects server-truncated CodeSystems despite content complete', () => {
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: system, content: 'complete', count: 210513,
      concept: [{ code: 'a' }] };
    expect(assessFiniteCodeSystem(cs)).toMatchObject({ coverage: 'partial', reasons: ['codesystem-count-mismatch'] });
    cs.count = 1;
    cs.meta = { tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue', code: 'SUBSETTED' }] };
    expect(assessFiniteCodeSystem(cs).coverage).toBe('partial');
    cs.meta = undefined; cs.extension = [{ url: 'http://health-samurai.io/extensions/excised-data' }];
    expect(assessFiniteCodeSystem(cs).coverage).toBe('partial');
    cs.extension = undefined;
    expect(assessFiniteCodeSystem(cs).coverage).toBe('complete');
  });
  it.each([
    { total: 2, contains: [{ system, code: 'a' }] },
    { total: 1, offset: 1, contains: [{ system, code: 'a' }] },
    { contains: [{ system, code: 'a' }] },
    { total: 1, contains: [{ system, code: 'a' }], extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/valueset-unclosed' }] },
    { total: 1, contains: [{ code: 'a' }] },
    { total: 2, contains: [{ system, code: 'a' }, { system, code: 'a' }] },
  ])('does not certify incomplete expansion %j', expansion => {
    expect(assessStoredExpansion(valueSet({ expansion }))?.coverage).toBe('partial');
  });

  it('proves a closed empty expansion and preserves system and version identities', () => {
    expect(assessStoredExpansion(valueSet({ expansion: { total: 0, contains: [] } })))
      .toMatchObject({ coverage: 'complete', concepts: [] });
    const result = assessStoredExpansion(valueSet({ expansion: { total: 3, contains: [
      { system, version: '1', code: 'a' }, { system, version: '2', code: 'a' }, { system: 'other', version: '1', code: 'a' },
    ] } }));
    expect(result?.coverage).toBe('complete');
    expect(result?.concepts).toHaveLength(3);
  });

  it('propagates missing and filtered exclusions instead of accepting a positive result', async () => {
    const vs = valueSet({ compose: { include: [{ system, concept: [{ code: 'a' }] }], exclude: [{ valueSet: ['missing'] }] } });
    expect(await expandFiniteValueSet(vs, resolver())).toMatchObject({ coverage: 'partial' });
    vs.compose!.exclude = [{ system, filter: [{ property: 'concept', op: 'is-a', value: 'root' }] }];
    expect((await expandFiniteValueSet(vs, resolver())).coverage).toBe('partial');
  });

  it('evaluates hierarchy inclusions and exclusions only with a closed local authority', async () => {
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: system, version: '1', content: 'complete',
      hierarchyMeaning: 'is-a', caseSensitive: true, count: 4,
      concept: [{ code: 'root', concept: [{ code: 'child', concept: [{ code: 'leaf' }] }] }, { code: 'other' }] };
    const vs = valueSet({ compose: { include: [{ system, version: '1', filter: [{ property: 'concept', op: 'is-a', value: 'root' }] }],
      exclude: [{ system, version: '1', filter: [{ property: 'concept', op: 'descendent-of', value: 'child' }] }] } });
    expect(await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).toMatchObject({ coverage: 'complete',
      concepts: [{ system, version: '1', code: 'root' }, { system, version: '1', code: 'child' }] });
    cs.hierarchyMeaning = 'grouped-by';
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('partial');
    cs.hierarchyMeaning = 'is-a'; cs.count = 5;
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('partial');
  });

  it('does not turn unsupported or ambiguous filters into a closed empty expansion', async () => {
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: system, content: 'complete',
      caseSensitive: true, concept: [{ code: 'a' }] };
    const vs = valueSet({ compose: { include: [{ system, filter: [{ property: 'unknown', op: '=', value: 'x' }] }] } });
    expect(await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).toMatchObject({ coverage: 'partial', reasons: ['unsupported-filter'] });
    vs.compose!.include[0].filter = [{ property: 'concept', op: 'is-a', value: 'absent' }];
    expect(await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).toMatchObject({ coverage: 'partial', reasons: ['filter-membership-unproven'] });
    vs.compose!.include[0].concept = [{ code: 'a' }];
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('partial');
  });

  it('intersects nested constraints, unions includes, and subtracts exclusions', async () => {
    const nested = valueSet({ url: 'nested', compose: { include: [{ system, concept: [{ code: 'b' }] }] } });
    const vs = valueSet({ compose: { include: [{ system, concept: [{ code: 'a' }, { code: 'b' }], valueSet: ['nested'] },
      { system, concept: [{ code: 'c' }] }], exclude: [{ system, concept: [{ code: 'c' }] }] } });
    expect(await expandFiniteValueSet(vs, resolver({ nested }))).toMatchObject({ coverage: 'complete', concepts: [{ system, code: 'b' }] });
  });

  it('refuses wrong CodeSystem versions and fragment inventories', async () => {
    const vs = valueSet({ compose: { include: [{ system, version: '1' }] } });
    const cs: CodeSystem = { resourceType: 'CodeSystem', url: system, version: '2', content: 'complete', concept: [{ code: 'a' }] };
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('partial');
    cs.version = '1'; cs.content = 'fragment';
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('partial');
    cs.content = 'complete';
    expect((await expandFiniteValueSet(vs, resolver({}, { [system]: cs }))).coverage).toBe('complete');
  });

  it('bounds cycles and oversize expansions', async () => {
    const vs = valueSet({ compose: { include: [{ valueSet: ['cycle'] }] } });
    expect((await expandFiniteValueSet(vs, resolver({ cycle: vs }))).coverage).toBe('partial');
    const expanded = valueSet({ expansion: { total: 2, contains: [{ system, code: 'a' }, { system, code: 'b' }] } });
    expect(assessStoredExpansion(expanded, 1)?.reasons).toContain('expansion-size-limit');
  });
});
