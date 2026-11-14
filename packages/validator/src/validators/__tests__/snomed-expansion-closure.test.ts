import { describe, expect, it } from 'vitest';
import { assessFiniteCodeSystem, assessStoredExpansion, expandFiniteValueSet } from '../finite-valueset-expansion.js';
import { qualifiedExpansionMembership } from '../qualified-expansion-membership.js';
import type { CodeSystem, ValueSet, ValueSetComposeInclude } from '../valueset-types.js';

const system = 'http://snomed.info/sct';
const version = `${system}/900000000000207008/version/20260701`;
const codeSystem: CodeSystem = { resourceType: 'CodeSystem', url: system, version,
  content: 'fragment', caseSensitive: true, concept: [{ code: '409822003' }] };
const valueSet = (entry: ValueSetComposeInclude): ValueSet => ({
  resourceType: 'ValueSet', url: 'https://example.test/organisms', status: 'active',
  compose: { include: [entry] },
  expansion: { total: 1, contains: [{ system, version, code: '409822003' }] },
});

describe('SNOMED expansion semantic closure', () => {
  it.each<ValueSetComposeInclude>([
    { system, version },
    { system, version, filter: [{ property: 'concept', op: 'is-a', value: '409822003' }] },
    { system: `${system}|${version}`, filter: [{ property: 'concept', op: 'descendent-of', value: '410607006' }] },
    { system, version, filter: [{ property: 'constraint', op: '=', value: '<< 409822003' }] },
  ])('keeps a full named expansion partial when the definition also admits expressions %#', async entry => {
    const definition = valueSet(entry);
    expect(assessStoredExpansion(definition)).toMatchObject({ coverage: 'partial',
      reasons: ['codesystem-grammar-not-enumerable'], concepts: [{ system, version, code: '409822003' }] });
    expect(await expandFiniteValueSet(definition, { valueSet: async () => null, codeSystem: async () => codeSystem }))
      .toMatchObject({ coverage: 'partial', reasons: ['codesystem-grammar-not-enumerable'] });
  });

  it.each(['409822003 |Domain Bacteria|', '=== 409822003'])('does not reject an unlisted expression from named expansion absence: %s', code => {
    const definition = valueSet({ system, version, filter: [{ property: 'concept', op: 'is-a', value: '409822003' }] });
    expect(qualifiedExpansionMembership(definition, codeSystem, code, version)).toBeNull();
  });

  it('does not certify an empty named expansion as an empty expression space', () => {
    const definition = valueSet({ system, version });
    definition.expansion = { total: 0, contains: [] };
    expect(assessStoredExpansion(definition)).toMatchObject({ coverage: 'partial', reasons: ['codesystem-grammar-not-enumerable'] });
  });

  it('retains the finite contract for explicit concept lists', async () => {
    const definition = valueSet({ system, version, concept: [{ code: '409822003' }] });
    expect(assessStoredExpansion(definition)?.coverage).toBe('complete');
    expect(await expandFiniteValueSet(definition, { valueSet: async () => null, codeSystem: async () => codeSystem }))
      .toMatchObject({ coverage: 'complete', concepts: [{ system, version, code: '409822003' }] });
    expect(qualifiedExpansionMembership(definition, codeSystem, '409822003', version)).toBe(true);
    expect(qualifiedExpansionMembership(definition, codeSystem, '404684003', version)).toBe(false);
    expect(qualifiedExpansionMembership(definition, codeSystem, '409822003', 'wrong-edition')).toBeNull();
  });

  it('recognizes SNOMED grammar even when a loaded catalog omits compositional', () => {
    expect(assessFiniteCodeSystem({ ...codeSystem, content: 'complete', count: 1 }))
      .toMatchObject({ coverage: 'partial', reasons: ['codesystem-grammar-not-enumerable'] });
  });

  it('does not turn an unrestricted exclusion into a finite membership proof', () => {
    const definition = valueSet({ system: 'https://example.test/codes', concept: [{ code: 'local' }] });
    definition.compose!.exclude = [{ system, version }];
    expect(assessStoredExpansion(definition)?.coverage).toBe('partial');
  });
});
