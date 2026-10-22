import { describe, expect, it } from 'vitest';
import { createProfileBindingSelector, withProfileBindingPreparation } from '../profile-binding-selection.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../../core/structure-definition-loader.js';

function fixture() {
  const profile: StructureDefinition = { resourceType: 'StructureDefinition', url: 'http://example.test/Patient',
    type: 'Patient', name: 'Patient', status: 'active', kind: 'resource', abstract: false, fhirVersion: '4.0.1',
    snapshot: { element: [
      { id: 'Patient', path: 'Patient' },
      { id: 'Patient.identifier', path: 'Patient.identifier', slicing: { rules: 'open', discriminator: [{ type: 'value', path: 'system' }] } },
      ...['a', 'b'].flatMap(slice => [
        { id: `Patient.identifier:${slice}`, path: 'Patient.identifier', sliceName: slice },
        { id: `Patient.identifier:${slice}.system`, path: 'Patient.identifier.system', fixedUri: `http://example.test/${slice}` },
        { id: `Patient.identifier:${slice}.type`, path: 'Patient.identifier.type',
          binding: { strength: 'required' as const, valueSet: `http://example.test/ValueSet/${slice}` } },
      ]),
    ] } };
  const resource = { resourceType: 'Patient', identifier: [{ system: 'http://example.test/a' }, { system: 'http://example.test/b' }] };
  const select = (rootResource = resource) => createProfileBindingSelector({
    profile, rootResource, basePath: 'Patient', value: rootResource, fhirVersion: 'R4',
    loader: { loadReferencedProfile: async () => null } as unknown as StructureDefinitionLoader,
  });
  return { profile, resource, select };
}

describe('profile binding preparation belongs to a structural invocation', () => {
  it('reuses definitions while still selecting membership for each indexed occurrence and current value', async () => {
    const { resource, select } = fixture();
    await withProfileBindingPreparation(async () => {
      const first = select(), second = select();
      expect((await first(undefined, 'Patient.identifier[0].type')).binding?.valueSet).toBe('http://example.test/ValueSet/a');
      expect((await second(undefined, 'Patient.identifier[1].type')).binding?.valueSet).toBe('http://example.test/ValueSet/b');
      resource.identifier[1].system = 'http://example.test/a';
      expect((await second(undefined, 'Patient.identifier[1].type')).binding?.valueSet).toBe('http://example.test/ValueSet/a');
    });
  });

  it('sees changed definitions in the next invocation on the same resource object', async () => {
    const { profile, select } = fixture();
    const run = () => withProfileBindingPreparation(() => select()(undefined, 'Patient.identifier[0].type'));
    expect((await run()).binding?.valueSet).toBe('http://example.test/ValueSet/a');
    profile.snapshot!.element = profile.snapshot!.element.map(element => element.binding
      ? { ...element, binding: { ...element.binding, valueSet: 'http://example.test/ValueSet/new' } } : element);
    expect((await run()).binding?.valueSet).toBe('http://example.test/ValueSet/new');
  });

  it('keeps overlapping resource occurrences independent under the same profile', async () => {
    const { resource, select } = fixture();
    const other = structuredClone(resource);
    other.identifier[0].system = 'http://example.test/b';
    const choices = await Promise.all([resource, other].map(root => withProfileBindingPreparation(async () => {
      await Promise.resolve();
      return (await select(root)(undefined, 'Patient.identifier[0].type')).binding?.valueSet;
    })));
    expect(choices).toEqual(['http://example.test/ValueSet/a', 'http://example.test/ValueSet/b']);
  });

  it('keeps sibling binding paths and their indexed occurrence proofs separate', async () => {
    const { profile, select } = fixture();
    profile.snapshot!.element.push(...['a', 'b'].map(slice => ({
      id: `Patient.identifier:${slice}.use`, path: 'Patient.identifier.use',
      binding: { strength: 'required' as const, valueSet: `http://example.test/ValueSet/use-${slice}` },
    })));
    await withProfileBindingPreparation(async () => {
      const first = select(), second = select();
      expect((await first(undefined, 'Patient.identifier[0].type')).binding?.valueSet).toBe('http://example.test/ValueSet/a');
      expect((await second(undefined, 'Patient.identifier[1].use')).binding?.valueSet).toBe('http://example.test/ValueSet/use-b');
      expect((await second(undefined, 'Patient.identifier[1].type')).binding?.valueSet).toBe('http://example.test/ValueSet/b');
      expect((await first(undefined, 'Patient.identifier[0].use')).binding?.valueSet).toBe('http://example.test/ValueSet/use-a');
    });
  });

  it('resolves type-profile dependencies again for another selector in the same invocation', async () => {
    const { profile, resource } = fixture();
    const slice = profile.snapshot!.element.find(element => element.id === 'Patient.identifier:a')!;
    slice.type = [{ code: 'Identifier', profile: ['http://example.test/StructureDefinition/Identifier'] }];
    let profileReads = 0;
    const select = () => createProfileBindingSelector({
      profile, rootResource: resource, basePath: 'Patient', value: resource, fhirVersion: 'R4',
      loader: { loadReferencedProfile: async () => { profileReads++; return null; } } as unknown as StructureDefinitionLoader,
    });
    await withProfileBindingPreparation(async () => {
      await select()(undefined, 'Patient.identifier[0].type');
      const firstReads = profileReads;
      expect(firstReads).toBeGreaterThan(0);
      await select()(undefined, 'Patient.identifier[0].type');
      expect(profileReads).toBeGreaterThan(firstReads);
    });
  });

  it('reuses a successful type-profile read only within one selector', async () => {
    const { profile, resource } = fixture();
    const canonical = 'http://example.test/StructureDefinition/Identifier';
    for (const slice of profile.snapshot!.element.filter(element => element.sliceName)) {
      slice.type = [{ code: 'Identifier', profile: [canonical] }];
    }
    const datatypeProfile: StructureDefinition = {
      resourceType: 'StructureDefinition', url: canonical, type: 'Identifier', name: 'Identifier',
      status: 'active', kind: 'complex-type', abstract: false, fhirVersion: '4.0.1',
      snapshot: { element: [{ id: 'Identifier', path: 'Identifier' }] },
    };
    let reads = 0;
    const select = () => createProfileBindingSelector({
      profile, rootResource: resource, basePath: 'Patient', value: resource, fhirVersion: 'R4',
      loader: { loadReferencedProfile: async () => { reads++; return datatypeProfile; } } as unknown as StructureDefinitionLoader,
    });

    await withProfileBindingPreparation(async () => {
      expect((await select()(undefined, 'Patient.identifier[0].type')).binding?.valueSet)
        .toBe('http://example.test/ValueSet/a');
      expect(reads).toBe(1);
      expect((await select()(undefined, 'Patient.identifier[0].type')).binding?.valueSet)
        .toBe('http://example.test/ValueSet/a');
      expect(reads).toBe(2);
    });
  });

  it('retries a missing type profile within the same selector', async () => {
    const { profile, resource } = fixture();
    for (const slice of profile.snapshot!.element.filter(element => element.sliceName)) {
      slice.type = [{ code: 'Identifier', profile: ['http://example.test/StructureDefinition/Identifier'] }];
    }
    let reads = 0;
    const select = createProfileBindingSelector({
      profile, rootResource: resource, basePath: 'Patient', value: resource, fhirVersion: 'R4',
      loader: { loadReferencedProfile: async () => { reads++; return null; } } as unknown as StructureDefinitionLoader,
    });
    await withProfileBindingPreparation(() => select(undefined, 'Patient.identifier[0].type'));
    expect(reads).toBeGreaterThan(1);
  });

});
