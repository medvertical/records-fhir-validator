import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import type { ValidateOneFn } from '../multi-aspect-types';
import type { StructureDefinition } from '../structure-definition-types';
import type { ProfileExecutor } from '../executors/profile-executor';
import { getValueAtPath } from '../validation-utils';
import type { ExtensionValidator } from '../../validators/extension-validator';

const definition = (type: string, publication?: unknown): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/' + type,
  name: 'SyntheticAbstract', status: 'active', kind: 'resource', abstract: true, type,
  ...(publication === undefined ? {} : { fhirVersion: publication }),
  snapshot: { element: [{ id: type, path: type }] },
});
const complete = (hardError = false) => vi.fn<ValidateOneFn>(async () => ({
  isValid: !hardError,
  aspects: [{ aspect: 'profile', validationTime: 0, isValid: !hardError,
    issues: hardError ? [{ id: 'synthetic-hard', aspect: 'profile', severity: 'error',
      code: 'synthetic-independent-error', message: 'Synthetic hard finding', timestamp: new Date() }] : [] }],
}));
const loader = (profile: StructureDefinition) =>
  ({ loadProfile: vi.fn(async () => profile) }) as unknown as MultiAspectDeps['sdLoader'];

describe('abstract resource profile applicability by request family', () => {
  it.each([
    ['R4', 'Resource', 'Patient'], ['R4', 'DomainResource', 'Patient'], ['R4', 'Resource', 'Bundle'],
    ['R5', 'DomainResource', 'Patient'], ['R5', 'DomainResource', 'ActorDefinition'],
  ] as const)('evaluates %s %s against known subtype %s', async (fhirVersion, type, resourceType) => {
    const profile = definition(type);
    const validateOne = complete();
    const check = createProfileConformanceCheck({ sdLoader: loader(profile), validateOne, fhirVersion, recursionDepth: 0 })!;
    const resource = { resourceType };
    await expect(check(resource, profile.url)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledWith(resource, profile.url, fhirVersion, 1, undefined, false, undefined, true);
  });

  it.each([
    ['R4', 'DomainResource', 'Bundle'], ['R5', 'DomainResource', 'Bundle'], ['R4', 'Resource', 'Identifier'],
  ] as const)('keeps %s %s foreign type %s inapplicable', async (fhirVersion, type, resourceType) => {
    const profile = definition(type);
    const validateOne = complete();
    const onIncomplete = vi.fn();
    const check = createProfileConformanceCheck({ sdLoader: loader(profile), validateOne, fhirVersion, recursionDepth: 0, onIncomplete })!;
    await expect(check({ resourceType }, profile.url)).resolves.toBe('not-applicable');
    expect(validateOne).not.toHaveBeenCalled();
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it.each([
    ['R6', 'Patient', undefined], ['R4', 'ActorDefinition', undefined], ['R4', 'SyntheticUnknown', undefined],
    ['R4', 'Patient', '5.0.0'], ['R4', 'Patient', ['4.0.1']],
  ] as const)('keeps unsupported hierarchy %s/%s/%j incomplete without evaluating', async (fhirVersion, resourceType, publication) => {
    const profile = definition('DomainResource', publication);
    const load = loader(profile);
    const validateOne = complete();
    const onIncomplete = vi.fn();
    const check = createProfileConformanceCheck({ sdLoader: load, validateOne, fhirVersion, recursionDepth: 0, onIncomplete })!;
    const resource = { resourceType };
    await expect(check(resource, profile.url)).resolves.toBeUndefined();
    await expect(check(resource, profile.url)).resolves.toBeUndefined();
    expect(validateOne).not.toHaveBeenCalled();
    expect(load.loadProfile).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenLastCalledWith(expect.objectContaining({
      code: 'profile-conformance-incomplete', severity: 'info',
      details: { validationComplete: false, profile: profile.url, causes: ['profile-type-applicability-unverified'] },
    }));
  });

  it('retains a genuinely evaluated hard failure and reuses only the completed verdict', async () => {
    const profile = definition('DomainResource', '4.0.1');
    const validateOne = complete(true);
    const check = createProfileConformanceCheck({ sdLoader: loader(profile), validateOne, fhirVersion: 'R4', recursionDepth: 0 })!;
    const resource = { resourceType: 'Patient' };
    await expect(check(resource, profile.url)).resolves.toBe(false);
    await expect(check(resource, profile.url)).resolves.toBe(false);
    expect(validateOne).toHaveBeenCalledTimes(1);
  });

  it('rechecks unsupported publication before caching the evaluated result', async () => {
    const profile = definition('DomainResource', '5.0.0');
    const load = loader(profile);
    const validateOne = complete();
    const onIncomplete = vi.fn();
    const check = createProfileConformanceCheck({ sdLoader: load, validateOne, fhirVersion: 'R4', recursionDepth: 0, onIncomplete })!;
    const resource = { resourceType: 'Patient' };
    await expect(check(resource, profile.url)).resolves.toBeUndefined();
    profile.fhirVersion = '4.0.1';
    await expect(check(resource, profile.url)).resolves.toBe(true);
    await expect(check(resource, profile.url)).resolves.toBe(true);
    expect(load.loadProfile).toHaveBeenCalledTimes(3);
    expect(validateOne).toHaveBeenCalledTimes(1);
    expect(onIncomplete).toHaveBeenCalledTimes(1);
  });
});

function inheritedRules() {
  const profile = definition('DomainResource', '4.0.1');
  profile.snapshot!.element.push(
    { id: 'DomainResource.text', path: 'DomainResource.text', type: [{ code: 'Narrative' }],
      constraint: [{ key: 'synthetic-narrative-kind', severity: 'error', human: 'Synthetic narrative kind',
        expression: "status = 'additional'", source: profile.url }] },
    { id: 'DomainResource.text.status', path: 'DomainResource.text.status', type: [{ code: 'code' }], fixedCode: 'additional' },
  );
  return profile;
}
async function actualExecutor(profile: StructureDefinition) {
  const directory = await mkdtemp(join(tmpdir(), 'abstract-profile-unit-'));
  const validator = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: null,
    terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false });
  try {
    await validator.waitForInitialization();
    const components = Reflect.get(validator, 'components') as {
      extensionValidator: ExtensionValidator; profileExecutor: ProfileExecutor;
    };
    const selected = vi.spyOn(components.extensionValidator, 'validateExtensions');
    const resource = { resourceType: 'Patient', text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">Synthetic</div>' } };
    const issues = await components.profileExecutor.validate({ resource, resourceType: 'Patient', profileUrl: profile.url,
      fhirVersion: 'R4', structureDef: profile, strictMode: false, getValueAtPath });
    return { issues, selected };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('inherited profile element rules on a concrete instance', () => {
  it('actually evaluates an ordinary child constraint at the concrete path', async () => {
    const profile = inheritedRules();
    const original = structuredClone(profile);
    const { issues } = await actualExecutor(profile);
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error',
      code: 'constraint-violation-synthetic-narrative-kind', path: 'Patient.text' }));
    expect(profile).toEqual(original);
  });

  it('actually checks a fixed child value instead of reading a fictitious abstract root property', async () => {
    const profile = inheritedRules();
    const original = structuredClone(profile);
    const { issues } = await actualExecutor(profile);
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error',
      code: 'profile-fixed-value-mismatch', path: 'Patient.text.status' }));
    expect(profile).toEqual(original);
  });

  it('keeps source identity and every rule while mapping local element addresses in a private view', async () => {
    const profile = inheritedRules();
    profile.snapshot!.element.push({ id: 'DomainResource.extension:synthetic', path: 'DomainResource.extension',
      contentReference: '#DomainResource.text' });
    profile.differential = { element: [{ id: 'DomainResource.text', path: 'DomainResource.text',
      contentReference: 'https://example.test/StructureDefinition/Foreign#DomainResource.text' }] };
    const original = structuredClone(profile);
    const { selected } = await actualExecutor(profile);
    const view = selected.mock.calls[0][1];
    expect(view).not.toBe(profile);
    expect({ url: view.url, type: view.type, fhirVersion: view.fhirVersion }).toEqual({
      url: profile.url, type: profile.type, fhirVersion: profile.fhirVersion,
    });
    expect(view.snapshot?.element.map(element => element.path)).toEqual(['Patient', 'Patient.text', 'Patient.text.status', 'Patient.extension']);
    expect(view.snapshot?.element[1].constraint).toEqual(profile.snapshot?.element[1].constraint);
    expect(view.snapshot?.element[2].fixedCode).toBe('additional');
    expect(view.snapshot?.element[3]).toEqual({ id: 'Patient.extension:synthetic', path: 'Patient.extension', contentReference: '#Patient.text' });
    expect(view.differential?.element[0]).toEqual({ id: 'Patient.text', path: 'Patient.text',
      contentReference: 'https://example.test/StructureDefinition/Foreign#DomainResource.text' });
    expect(profile).toEqual(original);
  });
});


describe('abstract instance marker admission before equality and inheritance', () => {
  it.each([
    ['R4', 'Resource', 'Resource'], ['R5', 'Resource', 'Resource'],
    ['R4', 'DomainResource', 'DomainResource'], ['R5', 'DomainResource', 'DomainResource'],
    ['R4', 'Resource', 'DomainResource'], ['R5', 'Resource', 'DomainResource'],
    ['R5', 'Resource', 'CanonicalResource'], ['R5', 'DomainResource', 'CanonicalResource'],
    ['R5', 'Resource', 'MetadataResource'], ['R5', 'DomainResource', 'MetadataResource'],
  ] as const)('does not route %s %s instance marker into %s evaluation', async (fhirVersion, type, resourceType) => {
    const profile = definition(type);
    const validateOne = vi.fn<ValidateOneFn>(async () => { throw new Error('Forbidden abstract instance evaluation'); });
    const onIncomplete = vi.fn();
    const load = loader(profile);
    const check = createProfileConformanceCheck({ sdLoader: load, validateOne, fhirVersion, recursionDepth: 0, onIncomplete })!;
    const resource = { resourceType };
    const expected = resourceType === 'Resource' || resourceType === 'DomainResource' ? 'not-applicable' : undefined;
    await expect(check(resource, profile.url)).resolves.toBe(expected);
    await expect(check(resource, profile.url)).resolves.toBe(expected);
    expect(validateOne).not.toHaveBeenCalled();
    expect(load.loadProfile).toHaveBeenCalledTimes(2);
    if (expected === undefined) {
      expect(onIncomplete).toHaveBeenCalledTimes(2);
      expect(onIncomplete).toHaveBeenLastCalledWith(expect.objectContaining({
        code: 'profile-conformance-incomplete', severity: 'info',
        details: { validationComplete: false, profile: profile.url, causes: ['profile-type-applicability-unverified'] },
      }));
    } else expect(onIncomplete).not.toHaveBeenCalled();
  });
});
