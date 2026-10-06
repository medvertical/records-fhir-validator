import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValidationDependencySnapshot, captureValidationDependency, markValidationDependencyUnattested } from './validation-dependency-snapshot';
import { getProfileSource, setProfileSource } from './persistence/profile-source';
import { ValueSetCache } from './validators/valueset-cache';
import { ValueSetPackageLoader } from './validators/valueset-package-loader';
import { lookupProfilePackageProvenance, recordProfilePackageProvenance } from './package/canonical-pin-provenance';
import type { StructureDefinition } from './core/structure-definition-types';

afterEach(() => setProfileSource({}));
const profile = (min: number) => ({ resourceType: 'StructureDefinition', url: 'https://example.org/Patient',
  type: 'Patient', snapshot: { element: [{ id: 'Patient.active', path: 'Patient.active', min }] } }) as StructureDefinition;

describe('captured validation dependencies', () => {
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
