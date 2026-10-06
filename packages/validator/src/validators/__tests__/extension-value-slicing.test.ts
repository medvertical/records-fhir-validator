import { describe, expect, it, vi } from 'vitest';
import { ExtensionValidator } from '../extension-validator';
import { getValueAtPath } from '../../core/validation-utils';
import type { StructureDefinition } from '../../core/structure-definition-types';

const url = 'https://example.test/StructureDefinition/evidence';
function definition(constrained: boolean): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url, type: 'Extension', name: 'Evidence',
    status: 'active', kind: 'complex-type', abstract: false,
    snapshot: { element: [
      { id: 'Extension', path: 'Extension', min: 0, max: '*' },
      { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
      { id: 'Extension.value[x].coding', path: 'Extension.value[x].coding', min: 1, max: '*',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' } },
      ...['evidence', 'qualifier'].flatMap(slice => [
        { id: `Extension.value[x].coding:${slice}`, path: 'Extension.value[x].coding', sliceName: slice, min: 0, max: '1' },
        { id: `Extension.value[x].coding:${slice}.system`, path: 'Extension.value[x].coding.system', min: 0, max: '1',
          ...(constrained ? { fixedUri: `urn:${slice}` } : {}) },
      ]),
    ] },
  };
}
async function validate(constrained: boolean, coding: Record<string, string>[]) {
  const profile = definition(constrained);
  const patient: StructureDefinition = { ...profile, url: 'https://example.test/Patient', type: 'Patient',
    kind: 'resource', snapshot: { element: [{ id: 'Patient', path: 'Patient' }] } };
  const loader = { loadProfile: vi.fn(async (canonical: string) => canonical === url ? profile : null),
    loadReferencedProfile: vi.fn(async (canonical: string) => canonical === url ? profile : null) };
  const validator = new ExtensionValidator(loader as any,
    { validate: vi.fn().mockResolvedValue([]) } as any,
    { validateBinding: vi.fn().mockResolvedValue([]) } as any,
    { validate: vi.fn().mockReturnValue([]) } as any);
  const resource = { resourceType: 'Patient', extension: [{ url, valueCodeableConcept: { coding } }] };
  return validator.validateExtensions(resource, patient, {
    resource, profileSD: patient, strictMode: false, fhirVersion: 'R4', profileUrl: patient.url, getValueAtPath,
  });
}

describe('slicing inside an extension value', () => {
  it('reports malformed child discriminators on the concrete extension value', async () => {
    const issues = await validate(false, [{ code: '1A' }]);
    const errors = issues.filter(issue => ['profile-slice-validation-error', 'profile-slice-validation-incomplete'].includes(issue.code ?? ''));
    expect(errors).toHaveLength(2);
    expect(errors.every(issue => issue.severity === 'error' && issue.path === 'Patient.extension[0].valueCodeableConcept.coding[0]')).toBe(true);
    expect(errors.every(issue => issue.target?.path === issue.path)).toBe(true);
    expect(errors.map(issue => typeof issue.details === 'object' ? issue.details?.sliceName : undefined).sort()).toEqual(['evidence', 'qualifier']);
  });
  it('accepts a conformant value and rejects a coding outside a closed slice set', async () => {
    expect((await validate(true, [{ system: 'urn:evidence', code: '1A' }])).filter(issue => issue.severity === 'error')).toEqual([]);
    expect((await validate(true, [{ system: 'urn:other', code: '1A' }])).some(issue => issue.severity === 'error')).toBe(true);
  });
});
