import { describe, expect, it, vi } from 'vitest';
import { ExtensionValidator } from '../extension-validator';
import { getValueAtPath } from '../../core/validation-utils';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';

const SIMPLE_URL = 'http://example.org/ext/simple-reference';

// A cross-version style extension: Extension.extension is left open and
// unsliced, the value is a plain Reference.
const simpleProfile = {
  resourceType: 'StructureDefinition',
  url: SIMPLE_URL,
  name: 'SimpleReference',
  status: 'active',
  kind: 'complex-type',
  abstract: false,
  type: 'Extension',
  snapshot: {
    element: [
      { id: 'Extension', path: 'Extension', min: 0, max: '*' },
      { id: 'Extension.extension', path: 'Extension.extension', min: 0, max: '*', type: [{ code: 'Extension' }] },
      { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: SIMPLE_URL },
      { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '1', type: [{ code: 'Reference' }] },
    ] as unknown as ElementDefinition[],
  },
} as StructureDefinition;

const patientProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/profile/patient',
  name: 'PlainPatient',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Patient',
  snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition] },
} as StructureDefinition;

describe('sub-extensions of an extension the profile does not slice', () => {
  it('report a relative url under an extension that defines none, not under one that cannot be loaded', async () => {
    const resource = {
      resourceType: 'Patient',
      id: 'p1',
      extension: [
        { url: SIMPLE_URL, extension: [{ url: 'concept', valueCodeableConcept: { text: 'left knee' } }] },
        { url: 'http://example.org/ext/unavailable', extension: [{ url: 'concept', valueString: 'x' }] },
      ],
    };
    const validator = new ExtensionValidator(
      { loadProfile: vi.fn(async (url: string) => (url === SIMPLE_URL ? simpleProfile : null)) } as never,
      { validate: vi.fn().mockResolvedValue([]) } as never,
      { validate: vi.fn().mockResolvedValue([]), validateBinding: vi.fn().mockResolvedValue([]) } as never,
      { validate: vi.fn().mockReturnValue([]) } as never,
    );

    const issues = await validator.validateExtensions(resource, patientProfile, {
      resource,
      profileSD: patientProfile,
      strictMode: false,
      fhirVersion: 'R4',
      profileUrl: patientProfile.url,
      getValueAtPath: (value: unknown, path: string) => getValueAtPath(value, path),
    });

    expect(issues.filter(issue => issue.code === 'profile-extension-subextension-invalid')).toEqual([
      expect.objectContaining({
        path: "Patient.extension[0].extension[url='concept']",
        message: `Sub-extension url 'concept' is not defined by the Extension ${SIMPLE_URL}`,
      }),
    ]);
  });

  it('are held to the value type their slice declares', async () => {
    const launchUrl = 'http://example.org/ext/launch-context';
    const launchProfile = {
      ...simpleProfile,
      url: launchUrl,
      name: 'LaunchContext',
      snapshot: {
        element: [
          { id: 'Extension', path: 'Extension', min: 0, max: '*' },
          { id: 'Extension.extension', path: 'Extension.extension', min: 1, max: '*', slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' } },
          { id: 'Extension.extension:name', path: 'Extension.extension', sliceName: 'name', min: 1, max: '1', type: [{ code: 'Extension' }] },
          { id: 'Extension.extension:name.url', path: 'Extension.extension.url', min: 1, max: '1', fixedUri: 'name' },
          { id: 'Extension.extension:name.value[x]', path: 'Extension.extension.value[x]', min: 1, max: '1', type: [{ code: 'Coding' }] },
          { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: launchUrl },
          { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '0' },
        ] as unknown as ElementDefinition[],
      },
    } as StructureDefinition;
    const resource = {
      resourceType: 'Patient',
      id: 'p1',
      extension: [{ url: launchUrl, extension: [{ url: 'name', valueId: 'LaunchPatient' }] }],
    };
    const validator = new ExtensionValidator(
      { loadProfile: vi.fn(async (url: string) => (url === launchUrl ? launchProfile : null)) } as never,
      { validate: vi.fn().mockResolvedValue([]) } as never,
      { validate: vi.fn().mockResolvedValue([]), validateBinding: vi.fn().mockResolvedValue([]) } as never,
      { validate: vi.fn().mockReturnValue([]) } as never,
    );

    const issues = await validator.validateExtensions(resource, patientProfile, {
      resource,
      profileSD: patientProfile,
      strictMode: false,
      fhirVersion: 'R4',
      profileUrl: patientProfile.url,
      getValueAtPath: (value: unknown, path: string) => getValueAtPath(value, path),
    });

    expect(issues.filter(issue => issue.code === 'profile-extension-wrong-value-type')).toEqual([
      expect.objectContaining({
        path: "Patient.extension[0].extension[url='name']",
        message: "The Extension 'name' definition allows for the types [Coding] but found type id",
      }),
    ]);
  });
});
