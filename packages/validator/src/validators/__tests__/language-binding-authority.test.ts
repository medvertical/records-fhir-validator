import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { isLanguageBinding, validateBCP47 } from '../valueset-language-utils.js';
import type { ValueSet } from '../valueset-types.js';

const system = 'urn:ietf:bcp:47';
const all = 'http://hl7.org/fhir/ValueSet/all-languages';
function validator(valueSet: ValueSet) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false } });
  expect(values.registerExternalTerminologyResource(valueSet, 'R4')).toBe(true);
  return values;
}
function definition(url = all): ValueSet {
  return { resourceType: 'ValueSet', url, version: '4.0.1', status: 'active', compose: { include: [{ system }] } };
}
afterEach(() => vi.restoreAllMocks());

describe('BCP47 grammar and binding membership have separate authority', () => {
  it.each(['x-private', 'i-klingon', 'en-u-ca-gregory', 'qaa-Qaaa-QM', 'sl-rozaj-biske-1994'])(
    'accepts valid language %s under the exact unrestricted definition', async code => {
      expect(validateBCP47(code)).toBe(true);
      await expect(validator(definition()).resolveCodeBindingForBinding(code, system, `${all}|4.0.1`, 'required', 'R4'))
        .resolves.toBe('valid');
    });
  it.each(['en-123456789', 'en-u', 'en-xyz', 'en-u-ca-gregory-u-nu-latn', 'sl-rozaj-rozaj'])(
    'rejects malformed/unregistered %s', async code => {
      expect(validateBCP47(code)).toBe(false);
      await expect(validator(definition()).resolveCodeBindingForBinding(code, system, all, 'required', 'R4'))
        .resolves.toBe('invalid');
    });
  it.each(['https://example.test/ValueSet/german', 'https://example.test/ValueSet/not-all-languages',
    'http://hl7.org/fhir/ValueSet/languages', all])('respects restricted membership at %s', async url => {
    const values = validator({ ...definition(url), compose: { include: [{ system, concept: [{ code: 'de' }] }] } });
    for (let round = 0; round < 2; round++) {
      await expect(values.resolveCodeBindingForBinding('de', system, url, 'required', 'R4')).resolves.toBe('valid');
      await expect(values.resolveCodeBindingForBinding('fr', system, url, 'required', 'R4')).resolves.toBe('invalid');
      await expect(values.isCodeInValueSet('de', system, url, 'R4')).resolves.toBe(true);
      await expect(values.isCodeInValueSet('fr', system, url, 'R4')).resolves.toBe(false);
    }
  });
  it('does not apply the grammar under a foreign Coding.system', async () => {
    await expect(validator(definition()).resolveCodeBindingForBinding('de', 'https://other.test', all, 'required', 'R4'))
      .resolves.not.toBe('valid');
  });
  it('does not replace an unavailable ValueSet edition with the current grammar', async () => {
    await expect(validator(definition()).resolveCodeBindingForBinding('de', system, `${all}|missing`, 'required', 'R4'))
      .resolves.toBe('unverified');
  });
  it('does not replace an explicit Coding.version with the current registry', async () => {
    await expect(validator(definition()).resolveCodeBindingForBinding('de', system, all, 'required', 'R4', undefined, 'missing'))
      .resolves.toBe('unverified');
  });
  it.each([false, true])('compares language lists case-insensitively with exclusion=%s', async excluded => {
    const url = 'https://example.test/ValueSet/language-subset';
    const values = validator({ ...definition(url), compose: {
      include: [{ system, concept: [{ code: 'de' }, { code: 'en-US' }, { code: 'en-x-k' }] }],
      ...(excluded ? { exclude: [{ system, concept: [{ code: 'DE' }] }] } : {}),
    } });
    for (const code of ['de', 'DE']) {
      await expect(values.resolveCodeBindingForBinding(code, system, url, 'required', 'R4'))
        .resolves.toBe(excluded ? 'invalid' : 'valid');
      await expect(values.isCodeInValueSet(code, system, url, 'R4')).resolves.toBe(!excluded);
    }
    await expect(values.resolveCodeBindingForBinding('EN-us', system, url, 'required', 'R4')).resolves.toBe('valid');
    await expect(values.resolveCodeBindingForBinding('fr', system, url, 'required', 'R4')).resolves.toBe('invalid');
    await expect(values.resolveCodeBindingForBinding('en-x-K', system, url, 'required', 'R4')).resolves.toBe('invalid');
  });
  it('honors a configured registry edition instead of accepting against the current one', async () => {
    const values = validator(definition());
    values.setResolutionConfig({ strategy: 'local-only', servers: [], defaultCodeSystemVersions: { [system]: 'missing' },
      serverDelegation: { validateCodes: false, expandValueSets: false } });
    await expect(values.resolveCodeBindingForBinding('de', system, all, 'required', 'R4')).resolves.toBe('unverified');
  });
});

describe('selected language definition authority', () => {
  it.each(['missing', 'different-url', 'different-version', 'exclude', 'filter', 'nested', 'system-version',
    'locked-date', 'inactive-policy', 'modifier', 'compose-modifier', 'include-modifier', 'subsetted'])('does not bypass %s', async kind => {
    const valueSet = definition();
    if (kind === 'different-url') valueSet.url = 'https://other.test';
    if (kind === 'different-version') valueSet.version = 'other';
    if (kind === 'exclude') valueSet.compose!.exclude = [{ system, concept: [{ code: 'de' }] }];
    if (kind === 'filter') valueSet.compose!.include![0].filter = [{ property: 'code', op: 'regex', value: 'de' }];
    if (kind === 'nested') valueSet.compose!.include![0].valueSet = ['https://other.test'];
    if (kind === 'system-version') valueSet.compose!.include![0].version = 'old';
    if (kind === 'locked-date') Object.assign(valueSet.compose!, { lockedDate: '2000-01-01' });
    if (kind === 'inactive-policy') Object.assign(valueSet.compose!, { inactive: false });
    const modifierExtension = [{ url: 'https://unknown.test/meaning', valueBoolean: true }];
    if (kind === 'modifier') Object.assign(valueSet, { modifierExtension });
    if (kind === 'compose-modifier') Object.assign(valueSet.compose!, { modifierExtension });
    if (kind === 'include-modifier') Object.assign(valueSet.compose!.include![0], { modifierExtension });
    if (kind === 'subsetted') Object.assign(valueSet, { meta: { tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue', code: 'SUBSETTED' }] } });
    const loader = { loadValueSetResource: vi.fn(async () => kind === 'missing' ? null : valueSet) };
    await expect(isLanguageBinding(`${all}|4.0.1`, system, loader, 'R4')).resolves.toBe(false);
    expect(loader.loadValueSetResource).toHaveBeenCalledWith(`${all}|4.0.1`, 'R4');
  });
  it('retains unavailable authority when the selected loader fails', async () => {
    await expect(isLanguageBinding(all, system, { loadValueSetResource: async () => { throw Error('unavailable'); } }, 'R4'))
      .resolves.toBe(false);
  });
});
