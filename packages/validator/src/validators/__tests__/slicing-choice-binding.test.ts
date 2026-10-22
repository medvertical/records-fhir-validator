import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const path = 'Organization.address.country.extension';
const boundUrl = 'https://example.org/country';
const genericUrl = 'http://hl7.org/fhir/StructureDefinition/iso21090-codedString';
const bindingUrl = 'https://example.org/countries';
const profile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: 'https://example.org/organization', name: 'Organization',
  status: 'active', kind: 'resource', abstract: false, type: 'Organization',
  snapshot: { element: [
    { id: path, path, slicing: { discriminator: [{ type: 'value', path: 'url' }, { type: 'value', path: 'value.ofType(Coding)' }], rules: 'closed' } },
    ...[boundUrl, genericUrl].map((url, index) => ({ id: `${path}:country${index}`, path, sliceName: `country${index}`,
      min: 0, max: '1', type: [{ code: 'Extension', profile: [url] }],
    })),
  ] },
};

function createValidator(resolveBinding = true) {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => resolveBinding ? ['urn:country|DE'] : null } });
  validator.setTypeProfileResolver(async url => ({
    ...profile, type: 'Extension', url,
    snapshot: { element: [
      { id: 'Extension', path: 'Extension' },
      { id: 'Extension.url', path: 'Extension.url', fixedUri: url },
      { id: 'Extension.value[x]', path: 'Extension.value[x]', type: [{ code: 'Coding' }],
        ...(url === boundUrl ? { binding: { strength: 'required', valueSet: bindingUrl } } : {}),
      },
    ] },
  }));
  return validator;
}

describe('choice-cast discriminators with inherited bindings', () => {
  const valid = { url: boundUrl, valueCoding: { system: 'urn:country', code: 'DE' } };
  it('uses required bindings from extension profiles and preserves the URL-only slice', async () => {
    const issues = await createValidator().validateSlicing([valid,
      { url: genericUrl, valueCoding: { system: 'urn:iso:std:iso:3166', code: 'DE' } },
    ], path, profile);
    expect(issues).toEqual([]);
  });
  it.each([
    { url: boundUrl, valueCoding: { system: 'urn:country', code: 'XX' } },
    { url: boundUrl, valueString: 'DE' },
  ])('does not match the wrong code or choice type', async element => {
    const issues = await createValidator().validateSlicing([element], path, profile);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(true);
  });
  it('enforces slice cardinality after resolving the inherited binding', async () => {
    const issues = await createValidator().validateSlicing([valid, valid], path, profile);
    expect(issues.some(issue => issue.severity === 'error')).toBe(true);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-error')).toBe(false);
  });
  it('reports incomplete slicing when the inherited binding cannot be resolved', async () => {
    const issues = await createValidator(false).validateSlicing([valid], path, profile);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-validation-incomplete',
      details: expect.objectContaining({ validationComplete: false }) }));
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
});
