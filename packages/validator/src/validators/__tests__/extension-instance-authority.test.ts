import { describe, expect, it, vi } from 'vitest';
import { ExtensionValidator } from '../extension-validator.js';
import { ProfileReferenceUnavailableError } from '../../core/profile-reference-authority.js';
import { getValueAtPath } from '../../core/validation-utils.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';

const extensionUrl = 'https://example.test/StructureDefinition/independent-extension';
const owner: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://example.test/Patient',
  version: '1', name: 'Patient', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
  snapshot: { element: [{ id: 'Patient', path: 'Patient' }] } };
const extension: StructureDefinition = { resourceType: 'StructureDefinition', url: extensionUrl,
  version: '2', name: 'IndependentExtension', status: 'active', kind: 'complex-type', abstract: false, type: 'Extension',
  context: [{ type: 'element', expression: 'Patient' }],
  snapshot: { element: [{ id: 'Extension', path: 'Extension', constraint: [{ key: 'independent-value',
    severity: 'error', human: 'The value must be ok', expression: "value.ofType(string) = 'ok'" }] },
  { id: 'Extension.url', path: 'Extension.url', fixedUri: extensionUrl },
  { id: 'Extension.value[x]', path: 'Extension.value[x]', type: [{ code: 'string' }] }] } };

function fixture() {
  const loader = {
    loadProfile: vi.fn(async (url: string) => url === extensionUrl ? extension : null),
    loadReferencedProfile: vi.fn(async (url: string, source?: { url?: string } | null) => {
      if (source?.url === owner.url) throw new ProfileReferenceUnavailableError({ canonical: url,
        source: { name: 'example.patient', version: '1' }, cause: 'dependency-missing' });
      return url === extensionUrl ? extension : null;
    }),
  };
  const validator = new ExtensionValidator(loader as never,
    { validate: vi.fn().mockResolvedValue([]) } as never,
    { validateBinding: vi.fn().mockResolvedValue([]) } as never,
    { validate: vi.fn().mockReturnValue([]) } as never);
  return { loader, validator };
}
function validate(validator: ExtensionValidator, profile: StructureDefinition, valueString: string) {
  const resource = { resourceType: 'Patient', extension: [{ url: extensionUrl, valueString }] };
  return validator.validateExtensions(resource, profile, { resource, profileSD: profile, profileUrl: profile.url,
    fhirVersion: 'R4', strictMode: false, getValueAtPath });
}

describe('instance extension authority', () => {
  it.each(['ok', 'bad'])('checks independently declared extension invariants for %s, cold and warm', async value => {
    const { validator, loader } = fixture();
    for (let round = 0; round < 2; round++) {
      const issues = await validate(validator, owner, value);
      expect(issues.filter(issue => issue.ruleId === 'independent-value')).toHaveLength(value === 'bad' ? 1 : 0);
      expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(false);
    }
    expect(loader.loadProfile).toHaveBeenCalledWith(extensionUrl, 'R4');
    expect(loader.loadReferencedProfile).not.toHaveBeenCalledWith(extensionUrl, owner, 'R4');
  });

  it('keeps an explicitly profiled extension bound to its declaring package', async () => {
    const { validator, loader } = fixture();
    const declared: StructureDefinition = { ...owner, snapshot: { element: [...owner.snapshot!.element,
      { id: 'Patient.extension:declared', path: 'Patient.extension', sliceName: 'declared',
        type: [{ code: 'Extension', profile: [extensionUrl] }] }] } };
    const issues = await validate(validator, declared, 'bad');
    expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(true);
    expect(issues.some(issue => issue.ruleId === 'independent-value')).toBe(false);
    expect(loader.loadProfile).not.toHaveBeenCalled();
  });
});
