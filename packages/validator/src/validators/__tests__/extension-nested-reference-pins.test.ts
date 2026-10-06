/**
 * A nested extension's profile is named by the extension definition that
 * declares its slice, so that definition's package dependencies decide its
 * release, as the HL7 reference validator resolves it.
 */
import { describe, expect, it, vi } from 'vitest';
import { ExtensionValidator } from '../extension-validator';
import { getValueAtPath } from '../../core/validation-utils';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';

const PARENT = 'http://example.org/ext/parent';
const CHILD = 'http://example.org/ext/child';
const OPEN_URL_SLICING = { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' };

function extensionDefinition(url: string, version: string, elements: unknown[]): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url,
    version,
    name: 'Example',
    status: 'active',
    kind: 'complex-type',
    abstract: false,
    type: 'Extension',
    snapshot: { element: elements as ElementDefinition[] },
  } as StructureDefinition;
}

const parentDefinition = extensionDefinition(PARENT, '2.0.0', [
  { id: 'Extension', path: 'Extension', min: 0, max: '*' },
  { id: 'Extension.extension', path: 'Extension.extension', min: 0, max: '*', slicing: OPEN_URL_SLICING },
  {
    id: 'Extension.extension:child',
    path: 'Extension.extension',
    sliceName: 'child',
    min: 0,
    max: '1',
    type: [{ code: 'Extension', profile: [CHILD] }],
  },
  { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: PARENT },
  { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '0' },
]);

// The release the parent's package depends on still defines `detail`.
const childRelease1 = extensionDefinition(CHILD, '1.0.0', [
  { id: 'Extension', path: 'Extension', min: 0, max: '*' },
  { id: 'Extension.extension', path: 'Extension.extension', min: 0, max: '*', slicing: OPEN_URL_SLICING },
  {
    id: 'Extension.extension:detail',
    path: 'Extension.extension',
    sliceName: 'detail',
    min: 0,
    max: '1',
    type: [{ code: 'Extension' }],
  },
  { id: 'Extension.extension:detail.url', path: 'Extension.extension.url', min: 1, max: '1', fixedUri: 'detail' },
  {
    id: 'Extension.extension:detail.value[x]',
    path: 'Extension.extension.value[x]',
    min: 1,
    max: '1',
    type: [{ code: 'string' }],
  },
  { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: CHILD },
  { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '0' },
]);

// The newest release dropped it.
const childRelease2 = extensionDefinition(CHILD, '2.0.0', [
  { id: 'Extension', path: 'Extension', min: 0, max: '*' },
  { id: 'Extension.extension', path: 'Extension.extension', min: 0, max: '*', slicing: OPEN_URL_SLICING },
  { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: CHILD },
  { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '0' },
]);

const patientProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/profile/patient',
  version: '1.0.0',
  name: 'PlainPatient',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Patient',
  snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition] },
} as StructureDefinition;

describe('nested extension dependency pins', () => {
  it('resolve a sub-extension profile at the release its declaring extension depends on', async () => {
    const definitions: Record<string, StructureDefinition> = {
      [PARENT]: parentDefinition,
      [`${CHILD}|1.0.0`]: childRelease1,
      [CHILD]: childRelease2,
    };
    const loader = {
      loadProfile: vi.fn(async (url: string) => definitions[url] ?? null),
      pinProfileReference: vi.fn(async (url: string, source?: { url?: string; version?: string }) =>
        url === CHILD && source?.url === PARENT && source.version === '2.0.0' ? `${CHILD}|1.0.0` : url),
    };
    const resource = {
      resourceType: 'Patient',
      id: 'p1',
      extension: [{
        url: PARENT,
        extension: [{ url: CHILD, extension: [{ url: 'detail', valueString: 'left knee' }] }],
      }],
    };
    const validator = new ExtensionValidator(
      loader as never,
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

    expect(loader.pinProfileReference).toHaveBeenCalledWith(CHILD, parentDefinition, 'R4');
    expect(issues.filter(issue => issue.code === 'profile-extension-subextension-invalid')).toEqual([]);
  });
});
