import { describe, expect, it, vi } from 'vitest';
import { SnapshotGenerator } from '../snapshot-generator.js';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { recordProfilePackageProvenance, lookupProfilePackageDirectory } from '../../package/canonical-pin-provenance.js';
import { snapshotTypeSource } from '../snapshot-type-profile-authority.js';
import { profileDefinitionSourceKey, selectedProfileIdentity, selectedProfileLookup, withSelectedProfileDefinition } from '../profile-reference-authority.js';

function definition(url: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, version: '1.0.0', name: 'Patient',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1' };
}

function fixture(includeTypeProfile = true) {
  const child = { ...definition('http://example.test/Patient'),
    baseDefinition: 'http://example.test/BasePatient',
    differential: { element: [{ id: 'Patient.active', path: 'Patient.active', min: 1 }] } };
  recordProfilePackageProvenance(child, 'example.child#1.0.0', '/synthetic/child/package');
  let baseDirectory = '/synthetic/base-a/package';
  let baseMin = 0;
  let owner = {};
  const loadReferencedProfile = vi.fn(async () => {
    const base = { ...definition(child.baseDefinition), snapshot: { element: [
      { id: 'Patient', path: 'Patient', min: 0, max: '*' },
      { id: 'Patient.name', path: 'Patient.name', min: baseMin, max: '*', type: [{ code: 'HumanName', profile: includeTypeProfile ? ['http://example.test/Name'] : [] }] },
      { id: 'Patient.active', path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
    ] } };
    recordProfilePackageProvenance(base, 'example.base#1.0.0', baseDirectory);
    return base;
  });
  const loader = { loadReferencedProfile, getDependencyCaptureScope: () => owner } as unknown as StructureDefinitionLoader;
  return { child, generator: new SnapshotGenerator(loader), loadReferencedProfile,
    changeBase: (minimum: number) => { baseMin = minimum; },
    changeAuthority: () => { baseDirectory = '/synthetic/base-b/package'; },
    changeOwner: () => { owner = {}; },
  };
}

describe('generated package snapshots retain their complete dependency basis', () => {
  it('reuses a prepared snapshot only after rereading unchanged dependencies, and detaches returned elements', async () => {
    const { generator, child, loadReferencedProfile } = fixture();
    const first = await generator.generateSnapshot(child, { fhirVersion: 'R4' });
    first.find(element => element.path === 'Patient.active')!.min = 0;
    const second = await generator.generateSnapshot(child, { fhirVersion: 'R4' });
    expect(second.find(element => element.path === 'Patient.active')?.min).toBe(1);
    second.find(element => element.path === 'Patient.active')!.min = 2;
    expect((await generator.generateSnapshot(child, { fhirVersion: 'R4' }))
      .find(element => element.path === 'Patient.active')?.min).toBe(1);
    expect(loadReferencedProfile).toHaveBeenCalledTimes(3);
    expect(generator.getCacheStats().size).toBe(1);
  });

  it('rebuilds when parent bytes change at the same canonical and package version', async () => {
    const { generator, child, changeBase } = fixture();
    expect((await generator.generateSnapshot(child)).find(element => element.path === 'Patient.name')?.min).toBe(0);
    changeBase(1);
    expect((await generator.generateSnapshot(child)).find(element => element.path === 'Patient.name')?.min).toBe(1);
    expect(generator.getCacheStats().size).toBe(2);
  });

  it('keeps inherited type-profile authority when equal JSON comes from a different package directory', async () => {
    const { generator, child, changeAuthority } = fixture();
    const first = await generator.generateSnapshot(child);
    changeAuthority();
    const second = await generator.generateSnapshot(child);
    const sourceDirectory = (elements: typeof first) => lookupProfilePackageDirectory(
      snapshotTypeSource(elements.find(element => element.path === 'Patient.name')!.type![0], child));
    expect(sourceDirectory(first)).toBe('/synthetic/base-a/package');
    expect(sourceDirectory(second)).toBe('/synthetic/base-b/package');
    expect(generator.getCacheStats().size).toBe(2);
  });

  it('separates family, resolution owner, and constraint application', async () => {
    const { generator, child, changeOwner } = fixture();
    await generator.generateSnapshot(child, { fhirVersion: 'R4' });
    await generator.generateSnapshot(child, { fhirVersion: 'R5' });
    await generator.generateSnapshot(child, { fhirVersion: 'R4', applyConstraints: false });
    changeOwner();
    await generator.generateSnapshot(child, { fhirVersion: 'R4' });
    expect(generator.getCacheStats().size).toBe(4);
  });

  it('retains changed parent authority even on types with empty profile reference arrays', async () => {
    const { generator, child, changeAuthority } = fixture(false);
    const first = await generator.generateSnapshot(child);
    changeAuthority();
    const second = await generator.generateSnapshot(child);
    const sourceDirectory = (elements: typeof first) => lookupProfilePackageDirectory(
      snapshotTypeSource(elements.find(element => element.path === 'Patient.name')!.type![0], child));
    expect(sourceDirectory(first)).toBe('/synthetic/base-a/package');
    expect(sourceDirectory(second)).toBe('/synthetic/base-b/package');
  });

  it('does not retain a missing parent as a completed snapshot', async () => {
    const { generator, child, loadReferencedProfile } = fixture();
    loadReferencedProfile.mockResolvedValueOnce(null as never);
    await generator.generateSnapshot(child);
    expect(generator.getCacheStats().size).toBe(0);
    await generator.generateSnapshot(child);
    expect(generator.getCacheStats().size).toBe(1);
  });

  it('reads selected identity without exposing the owned definition and keeps lookup copies detached', async () => {
    const { child } = fixture();
    const sourceKey = profileDefinitionSourceKey(child);
    await withSelectedProfileDefinition(child, 'R4', async () => {
      const identity = selectedProfileIdentity(child.url, 'R4');
      expect(identity).toEqual({ key: sourceKey, type: 'Patient' });
      expect(selectedProfileIdentity(child.url, 'R5')).toBeUndefined();
      expect(selectedProfileIdentity('http://example.test/Other', 'R4')).toBeUndefined();
      const copy = selectedProfileLookup(child.url, 'R4')!.profile;
      copy.differential!.element[0].min = 0;
      expect(selectedProfileLookup(child.url, 'R4')!.profile.differential!.element[0].min).toBe(1);
      expect(selectedProfileIdentity(child.url, 'R4')).toEqual(identity);
    }, sourceKey);
  });
});
