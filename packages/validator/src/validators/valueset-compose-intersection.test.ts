import { describe, expect, it } from 'vitest';
import { collectCodesFromValueSet } from './valueset-package-expansion';
import type { CodeSystem, ValueSet } from './valueset-types';

const system = 'https://example.org/system';
const terminology: CodeSystem = { resourceType: 'CodeSystem', url: system, content: 'complete',
  concept: [{ code: 'parent', concept: [{ code: 'alpha' }, { code: 'beta' }] }, { code: 'gamma' }],
};
const enumerated = (url: string, codes: string[], codeSystem = system): ValueSet => ({
  resourceType: 'ValueSet', url, status: 'active',
  compose: { include: [{ system: codeSystem, concept: codes.map(code => ({ code })) }] },
});
const subsets = new Map([
  ['https://example.org/a', enumerated('https://example.org/a', ['alpha', 'gamma'])],
  ['https://example.org/b', enumerated('https://example.org/b', ['beta', 'gamma'])],
  ['https://example.org/foreign', enumerated('https://example.org/foreign', ['alpha', 'gamma'], 'https://example.org/foreign-system')],
]);
const resolver = {
  loadValueSetResource: async (canonical: string) => subsets.get(canonical) ?? null,
  loadCodeSystem: async () => terminology,
};
const expand = (compose: ValueSet['compose']) => collectCodesFromValueSet({
  resourceType: 'ValueSet', url: 'https://example.org/result', status: 'active', compose,
}, resolver, new Set(), 0, '4');

describe('FHIR ValueSet composition intersections and exclusions', () => {
  it('requires every filter in a clause to match', async () => {
    const codes = await expand({ include: [{ system, filter: [
      { property: 'concept', op: 'is-a', value: 'parent' },
      { property: 'concept', op: '=', value: 'alpha' },
    ] }] });
    expect(codes).toEqual([`${system}|alpha`, 'alpha']);
  });

  it('intersects multiple referenced ValueSets within one include', async () => {
    const codes = await expand({ include: [{ valueSet: ['https://example.org/a', 'https://example.org/b'] }] });
    expect(codes).toEqual([`${system}|gamma`, 'gamma']);
  });

  it('intersects the system filter and the referenced ValueSet', async () => {
    const codes = await expand({ include: [{ system, valueSet: ['https://example.org/a'],
      filter: [{ property: 'concept', op: 'is-a', value: 'parent' }],
    }] });
    expect(codes).toEqual([`${system}|alpha`, 'alpha']);
  });

  it('does not join identical code strings across different CodeSystems', async () => {
    expect(await expand({ include: [{ valueSet: ['https://example.org/a', 'https://example.org/foreign'] }] })).toEqual([]);
  });

  it('applies an exclusion even when the referenced ValueSet also appeared in an include', async () => {
    const codes = await expand({
      include: [{ valueSet: ['https://example.org/a'] }, { valueSet: ['https://example.org/b'] }],
      exclude: [{ valueSet: ['https://example.org/a'] }],
    });
    expect(codes).toEqual([`${system}|beta`, 'beta']);
  });

  it('does not accept a partially known intersection when a referenced ValueSet is missing', async () => {
    expect(await expand({ include: [{ valueSet: ['https://example.org/a', 'https://example.org/missing'] }] })).toEqual([]);
  });
});
