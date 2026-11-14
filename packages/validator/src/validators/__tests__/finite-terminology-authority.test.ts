import { describe, expect, it } from 'vitest';
import { assessFiniteCodeSystem, assessStoredExpansion, expandFiniteValueSet } from '../finite-valueset-expansion';
import type { CodeSystem, ValueSet } from '../valueset-types';

const system = 'https://example.test/codes';
const cs = { resourceType: 'CodeSystem', url: system, content: 'complete', count: 1, concept: [{ code: 'a' }] } as CodeSystem;
const vs = { resourceType: 'ValueSet', url: 'https://example.test/vs', status: 'active',
  compose: { include: [{ system, concept: [{ code: 'a' }] }] } } as ValueSet;
const modifierExtension = [{ url: 'https://example.test/changes-membership', valueBoolean: true }];

describe('finite terminology authority boundary', () => {
  it.each([
    { ...cs, modifierExtension }, { ...cs, implicitRules: 'https://example.test/rules' },
    { ...cs, concept: [{ code: 17 }] }, { ...cs, concept: { code: 'a' } },
    { ...cs, concept: [{ code: 'a', modifierExtension }] }, { ...cs, caseSensitive: 'false' },
    { ...cs, meta: { tag: { code: 'SUBSETTED' } } }, { ...cs, extension: [null] },
  ])('does not certify malformed or modified CodeSystem authority %#', input => {
    expect(assessFiniteCodeSystem(input as unknown as CodeSystem).coverage).toBe('partial');
  });

  it.each([
    { ...vs, modifierExtension }, { ...vs, implicitRules: 'https://example.test/rules' },
    { ...vs, compose: { include: [{ system, concept: [{ code: 17 }] }] } },
    { ...vs, compose: { include: [{ system, concept: [{ code: 'a' }], modifierExtension }] } },
    { ...vs, compose: { include: [{ system: `${system}|1`, version: '2', concept: [{ code: 'a' }] }] } },
  ])('does not certify malformed or modified ValueSet authority %#', async input => {
    expect((await expandFiniteValueSet(input as unknown as ValueSet, { valueSet: async () => null, codeSystem: async () => cs })).coverage).toBe('partial');
  });

  it.each([
    { total: 1, contains: [{ system, code: 17 }] }, { total: 0, contains: { system, code: 'a' } },
    { total: 1, contains: [{ system, code: 'a', modifierExtension }] },
    { total: 1, contains: [{ system, code: 'a' }], modifierExtension },
    { total: 1, contains: [{ system, code: 'a' }], parameter: { name: 'activeOnly', valueBoolean: true } },
    { total: 1, contains: [{ system, code: 'a' }], extension: [null] },
  ])('does not treat invalid expansion metadata as a closed set %#', expansion => {
    expect(assessStoredExpansion({ ...vs, expansion } as unknown as ValueSet)?.coverage).toBe('partial');
  });

  it('continues to accept closed finite positive and negative membership evidence', async () => {
    const expansion = await expandFiniteValueSet(vs, { valueSet: async () => null, codeSystem: async () => cs });
    expect(expansion.coverage).toBe('complete');
    expect(expansion.concepts.some(concept => concept.code === 'a')).toBe(true);
    expect(expansion.concepts.some(concept => concept.code === 'b')).toBe(false);
  });

  it('can derive a qualified finite compose when a stored expansion is unusable', async () => {
    const source = { ...vs, expansion: { total: 0, contains: { code: 'bad' } } } as unknown as ValueSet;
    expect((await expandFiniteValueSet(source, { valueSet: async () => null, codeSystem: async () => cs })).coverage).toBe('complete');
  });
});
