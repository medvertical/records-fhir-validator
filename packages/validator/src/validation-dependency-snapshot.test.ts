import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValidationDependencySnapshot, captureValidationDependency, markValidationDependencyUnattested } from './validation-dependency-snapshot';
import { getProfileSource, setProfileSource } from './persistence/profile-source';
import { ValueSetCache } from './validators/valueset-cache';
import { ValueSetPackageLoader } from './validators/valueset-package-loader';
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
