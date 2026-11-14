import { describe, expect, it, vi } from 'vitest';
import { resolveVersionedLocalBinding } from '../valueset-versioned-local-binding.js';
import { resolveUnversionedLocalFilteredBinding } from '../valueset-filtered-local-binding.js';
import type { CodeSystem, ValueSet } from '../valueset-types.js';

const system = 'https://example.test/CodeSystem/property-closure';
const url = 'https://example.test/ValueSet/property-closure';
function fixture() {
  const codeSystem: CodeSystem = { resourceType: 'CodeSystem', url: system, version: '2026', content: 'complete',
    caseSensitive: true, property: [{ code: 'primary', type: 'string' }], concept: [
      { code: 'member', property: [{ code: 'primary', valueString: 'selected' }] },
      { code: 'outside', property: [{ code: 'primary', valueString: 'other' }] },
      { code: 'missing-property' },
    ] };
  const valueSet: ValueSet = { resourceType: 'ValueSet', url, version: '1', status: 'active',
    compose: { include: [{ system, filter: [{ property: 'primary', op: '=', value: 'selected' }] }] },
    expansion: { total: 1, offset: 0, parameter: [{ name: 'system-version', valueUri: `${system}|2026` }],
      contains: [{ system, version: '2026', code: 'member' }] } };
  const loader = { loadValueSetResource: vi.fn(async () => valueSet),
    loadCodeSystem: vi.fn(async () => codeSystem as CodeSystem | null),
    loadCodeSystemForValueSet: vi.fn(async () => codeSystem as CodeSystem | null) };
  const resolve = async (code = 'outside', edition?: string) => edition
    ? resolveVersionedLocalBinding(loader, code, system, edition, url, 'R4')
    : (await resolveUnversionedLocalFilteredBinding(loader, code, system, url, 'R4'));
  return { valueSet, codeSystem, loader, resolve };
}

describe('complete expansion authority for property-filtered bindings', () => {
  it.each(['2026', undefined])('proves members and nonmembers with edition %s', async edition => {
    const check = fixture();
    for (const [code, outcome] of [['member', 'valid'], ['outside', 'invalid'], ['missing-property', 'invalid']]) {
      const result = await check.resolve(code, edition);
      expect(typeof result === 'string' ? result : result.kind === 'evaluated' && result.outcome).toBe(outcome);
    }
  });
  it('does not infer complete properties from the ordinary CodeSystem', async () => {
    const check = fixture(); delete check.valueSet.expansion;
    expect(await check.resolve()).toMatchObject({ outcome: 'unverified' });
    expect(await check.resolve('missing-property', '2026')).toBe('unverified');
  });
  it.each(['2026', undefined])('keeps partial or restricted expansions unverified with edition %s', async edition => {
    const alterations: Array<(vs: ValueSet) => void> = [
      vs => { vs.expansion!.total = 2; },
      vs => { vs.expansion!.offset = 1; },
      vs => { delete vs.expansion!.total; },
      vs => { delete vs.expansion!.contains![0].version; },
      vs => { vs.expansion!.parameter = [{ name: 'activeOnly', valueBoolean: true }]; },
      vs => { vs.expansion!.parameter = [{ name: 'filter', valueString: 'member' }]; },
      vs => { vs.expansion!.parameter = [{ name: 'force-system-version', valueUri: `${system}|2026` }]; },
      vs => { vs.expansion!.parameter = [{ name: 'system-version', valueUri: `${system}|2025` }]; },
      vs => { vs.expansion!.parameter = [{ name: 'system-version' }]; },
      vs => { vs.meta = { tag: [{ code: 'SUBSETTED' }] }; },
      vs => { vs.extension = [{ url: 'http://hl7.org/fhir/StructureDefinition/valueset-unclosed', valueBoolean: true }]; },
    ];
    for (const change of alterations) {
      const check = fixture(); change(check.valueSet);
      const actual = await check.resolve('outside', edition);
      expect(typeof actual === 'string' ? actual : actual.kind === 'evaluated' && actual.outcome).toBe('unverified');
    }
  });
  it('uses only independently available facts for another edition', async () => {
    const check = fixture(); check.codeSystem.version = '2025';
    expect(await check.resolve('member', '2025')).toBe('valid');
    expect(await check.resolve('outside', '2025')).toBe('unverified');
    check.loader.loadCodeSystem.mockResolvedValue(null);
    expect(await check.resolve('outside', '1900')).toBe('unverified');
  });
  it.each(['2026', undefined])('does not override a proven compose exclusion with edition %s', async edition => {
    const check = fixture();
    check.valueSet.compose!.exclude = [{ system, concept: [{ code: 'member' }] }];
    const result = await check.resolve('member', edition);
    expect(typeof result === 'string' ? result : result.kind === 'evaluated' && result.outcome).toBe('invalid');
  });
  it('requires exact edition metadata even for an empty complete expansion', async () => {
    const check = fixture(); check.valueSet.expansion!.total = 0; check.valueSet.expansion!.contains = [];
    expect(await check.resolve('outside', '2026')).toBe('invalid');
    delete check.valueSet.expansion!.parameter;
    expect(await check.resolve('outside', '2026')).toBe('unverified');
  });
  it('retains the exact selected CodeSystem case policy', async () => {
    const check = fixture(); check.codeSystem.caseSensitive = false;
    check.codeSystem.concept![0].property = [];
    expect(await check.resolve('MEMBER', '2026')).toBe('valid');
    check.codeSystem.caseSensitive = undefined;
    expect(await check.resolve('outside', '2026')).toBe('unverified');
  });
});
