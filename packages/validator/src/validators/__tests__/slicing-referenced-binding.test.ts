import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const path = 'Organization.extension';
const libraryUrl = 'https://example.org/extension-library';
const countryUrl = 'https://example.org/country';
const bindingUrl = 'https://example.org/countries';
const elementReference = {
  extension: [{
    url: 'http://hl7.org/fhir/StructureDefinition/elementdefinition-profile-element',
    valueString: 'Extension.extension:country',
  }],
};
const referencedType = { code: 'Extension', profile: [libraryUrl], _profile: [elementReference] };
const library: StructureDefinition = {
  resourceType: 'StructureDefinition', url: libraryUrl, name: 'ExtensionLibrary',
  status: 'active', kind: 'complex-type', abstract: false, type: 'Extension',
  differential: { element: [
    { path: 'Extension.extension', sliceName: 'country' },
    { path: 'Extension.extension.url', fixedUri: countryUrl },
    { path: 'Extension.extension.value[x]', type: [{ code: 'Coding' }],
      binding: { strength: 'required', valueSet: bindingUrl } },
    { path: 'Extension.extension', sliceName: 'sibling' },
    { path: 'Extension.extension.value[x]', type: [{ code: 'Coding' }],
      binding: { strength: 'required', valueSet: 'https://example.org/sibling-codes' } },
  ] },
};
const profile: StructureDefinition = {
  ...library, url: 'https://example.org/organization', name: 'Organization',
  kind: 'resource', type: 'Organization', differential: undefined,
  snapshot: { element: [
    { id: path, path, slicing: { discriminator: [
      { type: 'value', path: 'url' }, { type: 'value', path: 'value.ofType(Coding)' },
    ], rules: 'closed' } },
    { id: `${path}:country`, path, sliceName: 'country', min: 0, max: '1',
      type: [referencedType],
    },
  ] },
};

function createValidator(resolveBinding = true, bindingStrength: 'required' | 'extensible' = 'required') {
  const validator = new SlicingValidator({ valueSetLoader: {
    loadValueSet: async url => resolveBinding && url === bindingUrl ? ['urn:country|DE'] : null,
  } });
  validator.setTypeProfileResolver(async url => url === libraryUrl ? {
    ...library, differential: { element: library.differential!.element.map(element => ({
      ...element, ...(element.binding ? { binding: { ...element.binding, strength: bindingStrength } } : {}),
    })) },
  } : null);
  return validator;
}

describe('required bindings from referenced profile elements', () => {
  const valid = { url: countryUrl, valueCoding: { system: 'urn:country', code: 'DE' } };

  it('uses the named slice binding relative to its own root', async () => {
    expect(await createValidator().validateSlicing([valid], path, profile)).toEqual([]);
  });

  it('rejects a code outside the referenced binding', async () => {
    const issues = await createValidator().validateSlicing([
      { url: countryUrl, valueCoding: { system: 'urn:country', code: 'XX' } },
    ], path, profile);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(true);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-error')).toBe(false);
  });

  it('enforces cardinality after matching the referenced slice', async () => {
    const issues = await createValidator().validateSlicing([valid, valid], path, profile);
    expect(issues.some(issue => issue.severity === 'error')).toBe(true);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-error')).toBe(false);
  });

  it('reports incomplete slicing if the referenced binding cannot be loaded', async () => {
    const issues = await createValidator(false).validateSlicing([valid], path, profile);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-validation-incomplete',
      details: expect.objectContaining({ validationComplete: false }) }));
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });

  it('does not use extensible bindings as discriminator evidence', async () => {
    const issues = await createValidator(true, 'extensible').validateSlicing([valid], path, profile);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-validation-incomplete',
      details: expect.objectContaining({ validationComplete: false }) }));
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
});
