import { describe, expect, it } from 'vitest';
import { ValueSetCache } from '../valueset-cache';
import type { ValueSetPackageLoader } from '../valueset-package-loader';
import type { CodeSystem } from '../valueset-types';
import { validateCodeInLocalCodeSystem } from '../valueset-local-code-system-validation';

const system = 'http://example.org/local-authority';
const complete = { resourceType: 'CodeSystem', url: system, content: 'complete', count: 1,
  caseSensitive: true, concept: [{ code: 'known', display: 'Known' }] };
function validate(resource: unknown, code = 'absent') {
  return validateCodeInLocalCodeSystem({ cache: new ValueSetCache(), packageLoader: {
    loadLocalTerminologyAuthority: async () => ({ kind: 'code-system', codeSystem: resource as CodeSystem }),
  } as unknown as ValueSetPackageLoader }, code, system, undefined, 'R4');
}
describe('local CodeSystem assertion authority', () => {
  it.each([false, undefined])('accepts case variants when CodeSystem.caseSensitive is %s', async caseSensitive => {
    expect(await validate({ ...complete, caseSensitive }, 'KNOWN')).toMatchObject({ valid: true });
  });
  it('keeps case-sensitive codes distinct', async () => {
    expect(await validate(complete, 'KNOWN')).toMatchObject({ valid: false, incompleteCodeSystem: false });
  });
  it('does not choose arbitrary case-insensitive duplicate concept definitions', async () => {
    expect(await validate({ ...complete, caseSensitive: false, count: 2,
      concept: [{ code: 'known', display: 'First' }, { code: 'KNOWN', display: 'Second' }] }, 'known')).toBeNull();
  });
  it.each([
    ['implicit rules', { ...complete, implicitRules: 'http://example.org/uninterpreted' }],
    ['modifier', { ...complete, modifierExtension: [{ url: 'http://example.org/modifier', valueBoolean: true }] }],
    ['count mismatch', { ...complete, count: 2 }],
    ['malformed compositional flag', { ...complete, compositional: 'true' }],
    ['malformed concept array', { ...complete, concept: { code: 'known' } }],
    ['modified concept', { ...complete, concept: [{ code: 'known', implicitRules: 'http://example.org/rules' }] }],
    ['malformed metadata', { ...complete, meta: { tag: ['SUBSETTED'] } }],
  ])('does not reject a code using %s', async (_name, resource) => {
    const result = await validate(resource);
    expect(result === null || result.incompleteCodeSystem === true).toBe(true);
  });
  it.each([
    { ...complete, implicitRules: 'http://example.org/uninterpreted' },
    { ...complete, concept: [{ code: 'known', modifierExtension: [{ url: 'http://example.org/modifier' }] }] },
    { ...complete, concept: [{ code: 'known', property: {} }] },
    { ...complete, concept: [{ code: 'known', property: [{ code: 'inactive', valueBoolean: true, valueCode: 'false' }] }] },
    { ...complete, count: 2, concept: [{ code: 'known', display: 'First' }, { code: 'known', display: 'Second' }] },
  ])('does not verify a concept whose consumed meaning is unavailable', async resource => {
    expect(await validate(resource, 'known')).toBeNull();
  });
  it('rejects an actually absent code from a complete qualified inventory', async () => {
    expect(await validate(complete)).toMatchObject({ valid: false, incompleteCodeSystem: false, reason: 'code-unknown' });
  });
  it('retains positive membership even when a fragment cannot establish absence', async () => {
    expect(await validate({ ...complete, content: 'fragment' }, 'known')).toMatchObject({ valid: true });
    expect(await validate({ ...complete, content: 'fragment' })).toMatchObject({ valid: false, incompleteCodeSystem: true });
  });
  it('retains rejection from an explicitly empty complete inventory with omitted optional concept array', async () => {
    expect(await validate({ ...complete, count: 0, concept: undefined })).toMatchObject({ valid: false, incompleteCodeSystem: false });
  });
  it('returns an incomplete result for cyclic non-JSON terminology instead of recursing without a bound', async () => {
    const concept: { code: string; concept?: unknown[] } = { code: 'known' }; concept.concept = [concept];
    const result = await validate({ ...complete, concept: [concept] });
    expect(result === null || result.incompleteCodeSystem === true).toBe(true);
  });
});
