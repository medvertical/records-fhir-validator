import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValidationDependencySnapshot, captureValidationDependency, markValidationDependencyUnattested,
  withBatchProfileMetadataCache, withProfileReferenceBatchSnapshot,
  withProfileReferenceInventorySnapshot } from './validation-dependency-snapshot';
import { getProfileSource, setProfileSource } from './persistence/profile-source';
import { ValueSetCache } from './validators/valueset-cache';
import { ValueSetPackageLoader } from './validators/valueset-package-loader';
import { lookupProfilePackageProvenance, recordProfilePackageProvenance } from './package/canonical-pin-provenance';
import type { StructureDefinition } from './core/structure-definition-types';

afterEach(() => setProfileSource({}));
const profile = (min: number) => ({ resourceType: 'StructureDefinition', url: 'https://example.org/Patient',
  type: 'Patient', snapshot: { element: [{ id: 'Patient.active', path: 'Patient.active', min }] } }) as StructureDefinition;

describe('captured validation dependencies', () => {
  it('shares actual package metadata within one batch and observes a fresh value in the next batch', async () => {
    let generation = 1;
    const read = vi.fn(async () => ({ generation }));
    const lookup = () => captureValidationDependency('profile', 'profile-reference-package-index', 'package', read);
    const first = await withProfileReferenceBatchSnapshot(async () => {
      const before = await withProfileReferenceInventorySnapshot(lookup);
      generation = 2;
      const after = await withProfileReferenceInventorySnapshot(lookup);
      return [before, after];
    });
    expect(first).toEqual([{ generation: 1 }, { generation: 1 }]);
    expect(await withProfileReferenceBatchSnapshot(lookup)).toEqual({ generation: 2 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('retries outside the batch capture when its entry budget is exhausted', async () => {
    let attempts = 0;
    const result = await withProfileReferenceBatchSnapshot(async () => {
      attempts++;
      if (attempts === 2) return 'ordinary-resolution';
      for (let index = 0; index <= 4096; index++) {
        try {
          await captureValidationDependency('profile', 'profile-reference-package-index', index, async () => index);
        } catch {
          return 'incomplete-batch-resolution';
        }
      }
      return 'unexpected';
    });
    expect(result).toBe('ordinary-resolution');
    expect(attempts).toBe(2);
  });

  it('does not replace an explicit evidence snapshot or share concurrent batches', async () => {
    const outer = createValidationDependencySnapshot();
    let reads = 0;
    const lookup = () => captureValidationDependency('profile', 'profile-reference-package-index', 'same',
      async () => ++reads);
    expect(await outer.run(() => withProfileReferenceBatchSnapshot(lookup))).toBe(1);
    expect(await outer.run(() => withProfileReferenceBatchSnapshot(lookup))).toBe(1);
    expect(outer.evidence()).toMatchObject({ status: 'captured', profileCount: 1 });
    expect(await Promise.all([withProfileReferenceBatchSnapshot(lookup), withProfileReferenceBatchSnapshot(lookup)]))
      .toEqual([2, 3]);
  });

  it('shares bounded package metadata while each resource captures its own definitions', async () => {
    let generation = 1;
    let definitionVersion = 1;
    const readMetadata = vi.fn(async () => ({ generation }));
    const readDefinition = vi.fn(async () => ({ definitionVersion }));
    const lookupMetadata = () => captureValidationDependency('profile', 'profile-reference-package-index', 'package', readMetadata);
    const lookupDefinition = () => captureValidationDependency('profile', 'load-referenced-profile', 'definition', readDefinition);
    await withBatchProfileMetadataCache(async () => {
      await withProfileReferenceInventorySnapshot(async () => {
        const first = await lookupMetadata();
        first.generation = 99;
        expect(await lookupMetadata()).toEqual({ generation: 1 });
        expect(await lookupDefinition()).toEqual({ definitionVersion: 1 });
      });
      generation = 2; definitionVersion = 2;
      await withProfileReferenceInventorySnapshot(async () => {
        expect(await lookupMetadata()).toEqual({ generation: 1 });
        expect(await lookupDefinition()).toEqual({ definitionVersion: 2 });
      });
    });
    expect(await withBatchProfileMetadataCache(lookupMetadata)).toEqual({ generation: 2 });
    expect(readMetadata).toHaveBeenCalledTimes(2);
    expect(readDefinition).toHaveBeenCalledTimes(2);
  });

  it('evicts package metadata rather than exhausting a batch snapshot budget', async () => {
    const read = vi.fn(async (key: number) => ({ key, padding: 'x'.repeat(1_500_000) }));
    await withBatchProfileMetadataCache(async () => {
      for (let key = 0; key < 12; key++) {
        await withProfileReferenceInventorySnapshot(() => captureValidationDependency('profile',
          'profile-reference-fallback-inventory', key, () => read(key)));
      }
      await withProfileReferenceInventorySnapshot(async () => {
        expect((await captureValidationDependency('profile', 'profile-reference-fallback-inventory', 0,
          () => read(0))).key).toBe(0);
      });
    });
    expect(read).toHaveBeenCalledTimes(13);
  });

  it('isolates concurrent batch metadata and leaves explicit evidence captures untouched', async () => {
    let reads = 0;
    const lookup = () => captureValidationDependency('profile', 'profile-reference-installed-manifests', 'store',
      async () => ({ sequence: ++reads }));
    const results = await Promise.all([
      withBatchProfileMetadataCache(() => withProfileReferenceInventorySnapshot(lookup)),
      withBatchProfileMetadataCache(() => withProfileReferenceInventorySnapshot(lookup)),
    ]);
    expect(results.map(result => result.sequence).sort()).toEqual([1, 2]);
    const explicit = createValidationDependencySnapshot();
    expect(await explicit.run(() => withBatchProfileMetadataCache(lookup))).toEqual({ sequence: 3 });
    expect(await explicit.run(() => withBatchProfileMetadataCache(lookup))).toEqual({ sequence: 3 });
    expect(explicit.evidence()).toMatchObject({ status: 'captured', profileCount: 1 });
  });

  it('isolates nested package metadata in the bounded inventory snapshot', async () => {
    const manifests = [{ ref: { name: 'example.ig', version: '1.0.0' }, canonical: null,
      fhirVersions: ['4.0.1'], dependencies: [{ name: 'example.base', version: '2.0.0' }],
      storeRank: 0, packageDirectory: '/packages/example.ig/package' }];
    const index = { status: 'read' as const, boundary: '/packages/example.ig/package',
      files: [{ resourceType: 'StructureDefinition', url: 'https://example.org/Profile', filename: 'Profile.json' }] };
    const expectedManifests = structuredClone(manifests);
    const expectedIndex = structuredClone(index);
    const readManifests = vi.fn(async () => manifests);
    const readIndex = vi.fn(async () => index);
    await withProfileReferenceInventorySnapshot(async () => {
      const first = await captureValidationDependency('profile', 'profile-reference-installed-manifests', 'store', readManifests);
      first[0].ref.name = 'mutated'; first[0].fhirVersions[0] = '5.0.0'; first[0].dependencies[0].version = '9.0.0';
      const firstIndex = await captureValidationDependency('profile', 'profile-reference-package-index', 'package', readIndex);
      firstIndex.files[0].url = 'https://example.org/Mutated';
      manifests[0].dependencies[0].version = '3.0.0';
      index.files[0].filename = 'Changed.json';
      const second = await captureValidationDependency('profile', 'profile-reference-installed-manifests', 'store', readManifests);
      const secondIndex = await captureValidationDependency('profile', 'profile-reference-package-index', 'package', readIndex);
      expect(second).toEqual(expectedManifests);
      expect(secondIndex).toEqual(expectedIndex);
    });
    expect(readManifests).toHaveBeenCalledTimes(1);
    expect(readIndex).toHaveBeenCalledTimes(1);
    expect(manifests[0].ref.name).toBe('example.ig');
    expect(index.files[0].url).toBe('https://example.org/Profile');
  });

  it('freezes host profiles, detached from source changes and consumer mutations', async () => {
    let current = profile(0);
    const resolveProfile = vi.fn(async () => current);
    setProfileSource({ resolveProfile });
    const snapshot = createValidationDependencySnapshot();
    const read = () => getProfileSource().resolveProfile!('https://example.org/Patient', undefined, undefined);
    const first = await snapshot.run(read);
    first!.snapshot!.element[0].min = 9;
    current = profile(1);
    expect((await snapshot.run(read))!.snapshot!.element[0].min).toBe(0);
    expect(resolveProfile).toHaveBeenCalledTimes(1);
    expect(snapshot.evidence()).toMatchObject({ status: 'captured', profileCount: 1 });
    const fresh = createValidationDependencySnapshot();
    expect((await fresh.run(read))!.snapshot!.element[0].min).toBe(1);
    expect(fresh.evidence().hash).not.toBe(snapshot.evidence().hash);
  });

  it('captures cached terminology definitions and expansions before they change', async () => {
    const cache = new ValueSetCache();
    cache.setExpandedCodes('v', new Set(['a']));
    cache.setCodeSystemFile('s', { resourceType: 'CodeSystem', url: 's', content: 'complete', concept: [{ code: 'a' }] });
    const loader = new ValueSetPackageLoader(cache);
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      expect((await loader.loadCodeSystem('s'))?.concept?.map(concept => concept.code)).toEqual(['a']);
      cache.getExpandedCodes('v')!.add('consumer-mutation');
    });
    cache.setExpandedCodes('v', new Set(['b']));
    cache.setCodeSystemFile('s', { resourceType: 'CodeSystem', url: 's', content: 'complete', concept: [{ code: 'b' }] });
    await snapshot.run(async () => {
      expect([...cache.getExpandedCodes('v')!]).toEqual(['a']);
      expect((await loader.loadCodeSystem('s'))?.concept?.map(concept => concept.code)).toEqual(['a']);
    });
  });

  it('isolates simultaneous snapshots and shares only identical lookups within one snapshot', async () => {
    const left = createValidationDependencySnapshot(), right = createValidationDependencySnapshot();
    const read = vi.fn(async (tenant: string) => ({ tenant }));
    const query = (tenant: string) => captureValidationDependency('profile', 'test', 'same-key', () => read(tenant));
    const [a, b] = await Promise.all([
      left.run(() => Promise.all([query('left'), query('left')])), right.run(() => query('right')),
    ]);
    expect(a).toEqual([{ tenant: 'left' }, { tenant: 'left' }]);
    expect(b).toEqual({ tenant: 'right' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('retains missing dependencies and refuses attestation after lookup failures or online terminology', async () => {
    const snapshot = createValidationDependencySnapshot();
    const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(profile(1));
    await snapshot.run(async () => {
      expect(await captureValidationDependency('profile', 'missing', 'p', read)).toBeNull();
      expect(await captureValidationDependency('profile', 'missing', 'p', read)).toBeNull();
      markValidationDependencyUnattested('Online terminology has no immutable dataset.');
      await expect(captureValidationDependency('profile', 'failed', 'q', async () => { throw new Error('unavailable'); }))
        .rejects.toThrow('unavailable');
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested', reason: expect.stringContaining('Online terminology') });
    expect(JSON.stringify(snapshot.evidence())).not.toContain('https://example.org/Patient');
  });
});


describe('captured issued profile origins', () => {
  it.each([false, true])('retains authentic origin through detached copies and nested captures (%s)', async nested => {
    const original = { ...profile(0), version: '7.0.0' };
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const origin = lookupProfilePackageProvenance(original);
    const snapshot = createValidationDependencySnapshot();
    const resolve = vi.fn(async () => original);
    const inner = () => captureValidationDependency('profile', 'inner', 'p', resolve);
    const read = () => nested ? captureValidationDependency('profile', 'outer', 'p', inner) : inner();
    const first = await snapshot.run(read);
    expect(lookupProfilePackageProvenance(first)).toBe(origin);
    expect(first).not.toBe(original);
    const hash = snapshot.evidence().hash;
    first.version = 'foreign'; first.snapshot!.element[0].min = 9;
    original.version = 'changed-source'; original.snapshot!.element[0].min = 8;
    const second = await snapshot.run(read);
    expect(second.version).toBe('7.0.0'); expect(second.snapshot!.element[0].min).toBe(0);
    expect(lookupProfilePackageProvenance(second)).toBe(origin);
    expect(lookupProfilePackageProvenance(first)).toBeNull();
    expect(snapshot.evidence().hash).toBe(hash); expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps versionless issued origin and FHIR-only lookup hashes unchanged', async () => {
    const original = profile(0);
    const host = structuredClone(original);
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const issued = createValidationDependencySnapshot(), ordinary = createValidationDependencySnapshot();
    const captured = await issued.run(() => captureValidationDependency('profile', 'identity', 'p', async () => original));
    const unscoped = await ordinary.run(() => captureValidationDependency('profile', 'identity', 'p', async () => host));
    expect(lookupProfilePackageProvenance(captured)).toEqual({ name: 'example.owner', version: '3.0.0' });
    expect(lookupProfilePackageProvenance(unscoped)).toBeNull();
    expect(JSON.stringify(captured)).toBe(JSON.stringify(host));
    expect(Object.keys(captured)).toEqual(Object.keys(host));
    expect(issued.evidence().hash).toBe(ordinary.evidence().hash);
  });
});


describe('private dependency reuse scopes and stable evidence', () => {
  it('separates owners without putting their identities or insertion order into evidence', async () => {
    const capture = async (order: number[]) => {
      const snapshot = createValidationDependencySnapshot(), owners = [{}, {}];
      const resolve = vi.fn(async (index: number) => profile(index));
      await snapshot.run(async () => {
        for (const index of order) {
          const loaded = await captureValidationDependency('profile', 'same', 'p', () => resolve(index), owners[index]);
          expect(loaded.snapshot!.element[0].min).toBe(index);
        }
      });
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(snapshot.evidence()).toMatchObject({ status: 'captured', profileCount: 2 });
      return snapshot.evidence();
    };
    expect(await capture([0, 1, 0])).toEqual(await capture([1, 0, 1]));
  });

  it('reserves a lookup before invoking its resolver and contains synchronous failures', async () => {
    const snapshot = createValidationDependencySnapshot();
    const lookup = vi.fn(() => { throw new Error('sync-failure'); });
    await snapshot.run(async () => {
      await expect(captureValidationDependency('profile', 'sync', 'p', lookup)).rejects.toThrow('sync-failure');
      await expect(captureValidationDependency('profile', 'sync', 'p', lookup)).rejects.toThrow('sync-failure');
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested' });
  });
});
