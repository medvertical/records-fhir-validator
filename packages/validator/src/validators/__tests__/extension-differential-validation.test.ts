import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { getValueAtPath } from '../../core/validation-utils';
import { ExtensionValidator } from '../extension-validator';

const url = 'https://example.test/StructureDefinition/episode';
const baseUrl = 'https://example.test/StructureDefinition/base-episode';
const base: StructureDefinition = {
  resourceType: 'StructureDefinition', url: baseUrl, type: 'Extension', name: 'BaseEpisode',
  status: 'active', kind: 'complex-type', abstract: false,
  snapshot: { element: [
    { id: 'Extension', path: 'Extension' },
    { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'code' }] },
  ] },
};

async function validate(inherited: boolean, value: Record<string, unknown>, fhirVersion: 'R4' | 'R5' | 'R6') {
  const profile: StructureDefinition = { ...base, url, snapshot: undefined,
    baseDefinition: baseUrl, differential: { element: inherited
      ? [{ id: 'Extension', path: 'Extension' }]
      : [{ id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'code' }] }],
    } };
  const patient: StructureDefinition = { ...base, url: 'https://example.test/Patient', type: 'Patient',
    kind: 'resource', snapshot: { element: [{ id: 'Patient', path: 'Patient' }] } };
  const loader = { loadProfile: vi.fn(async (canonical: string) => canonical === url ? profile : null),
    loadReferencedProfile: vi.fn(async (canonical: string) => canonical === baseUrl ? base : canonical === url ? profile : null) };
  const validator = new ExtensionValidator(loader as any,
    { validate: vi.fn().mockResolvedValue([]) } as any,
    { validateBinding: vi.fn().mockResolvedValue([]) } as any,
    { validate: vi.fn().mockReturnValue([]) } as any);
  const resource = { resourceType: 'Patient', extension: [{ url, ...value }] };
  const issues = await validator.validateExtensions(resource, patient, {
    resource, profileSD: patient, strictMode: false, fhirVersion, profileUrl: patient.url, getValueAtPath,
  });
  return { issues, loader, profile };
}

describe('extension definitions supplied as differentials', () => {
  it('rejects a concrete value type excluded by the differential', async () => {
    const { issues, profile } = await validate(false, { valueCodeableConcept: { coding: [{ code: 'new' }] } }, 'R4');
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'profile-extension-wrong-value-type', severity: 'error', path: 'Patient.extension[0]',
    })]));
    expect(profile.snapshot).toBeUndefined();
  });
  it.each(['R4', 'R5', 'R6'] as const)('validates inherited value types with the %s base definition', async fhirVersion => {
    const { issues, loader } = await validate(true, { valueString: 'new' }, fhirVersion);
    expect(issues.some(issue => issue.code === 'profile-extension-wrong-value-type')).toBe(true);
    expect(loader.loadReferencedProfile).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ url }), fhirVersion);
  });
  it('accepts an allowed concrete value and checks an inherited required value', async () => {
    expect((await validate(true, { valueCode: 'new' }, 'R4')).issues.filter(issue => issue.severity === 'error')).toEqual([]);
    expect((await validate(true, {}, 'R4')).issues.some(issue => issue.code === 'profile-extension-missing-value')).toBe(true);
  });
});
