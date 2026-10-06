import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { ProfileCache } from '../../cache/profile-cache';
import { getProfileSource, setProfileSource, type ProfileSource } from '../../persistence';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { StructureDefinition } from '../structure-definition-types';
import { SnapshotGenerator } from '../snapshot-generator';
import { loadProfileForValidation, loadProfileWithSnapshot } from '../profile-snapshot-loading';

const canonical = 'https://example.test/StructureDefinition/ScopePatient';
const roots: string[] = [];
afterEach(async () => {
  setProfileSource({});
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const definition = (min: number, version = '7.0.0'): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: canonical, version, fhirVersion: '4.0.1', type: 'Patient',
  kind: 'resource', derivation: 'constraint', snapshot: { element: [
    { id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.active', path: 'Patient.active', min, max: '1', type: [{ code: 'boolean' }] },
  ] },
});
const required = (profile: StructureDefinition | null) => profile?.snapshot?.element[1]?.min;
async function store(min: number, versions = ['7.0.0']) {
  const root = await mkdtemp(join(tmpdir(), 'records-profile-scope-')); roots.push(root);
  for (const [index, version] of versions.entries()) {
    const name = 'example.scope', release = `${index + 1}.0.0`;
    const folder = join(root, `${name}#${release}`, 'package'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version: release, fhirVersions: ['4.0.1'] }));
    await writeFile(join(folder, 'StructureDefinition-Patient.json'), JSON.stringify(definition(min + index, version)));
    await writeFile(join(folder, '.index.json'), JSON.stringify({ 'index-version': 2, files: [{
      resourceType: 'StructureDefinition', url: canonical, version, filename: 'StructureDefinition-Patient.json',
    }] }));
  }
  return root;
}
async function loader(first: string, second = first) {
  const result = new StructureDefinitionLoader(second, first, { autoDownload: false, prewarmProfileSource: false });
  await result.waitForInitialization(); return result;
}
function reader(sdLoader: StructureDefinitionLoader, api: 'direct' | 'snapshot' | 'validation') {
  const cache = new ProfileCache(), generator = new SnapshotGenerator(sdLoader);
  return (url = canonical) => api === 'direct' ? sdLoader.loadProfile(url, 'R4')
    : api === 'snapshot' ? loadProfileWithSnapshot(sdLoader, cache, generator, url, 'R4')
      : loadProfileForValidation(sdLoader, generator, url, 'R4', cache);
}

describe('captured profile resolution ownership', () => {
  for (const api of ['direct', 'snapshot', 'validation'] as const) {
    it(`${api} keeps actual ordered stores separate for identical canonical and business version`, async () => {
      const a = await store(0), b = await store(1);
      const left = reader(await loader(a, b), api), right = reader(await loader(b, a), api);
      const snapshot = createValidationDependencySnapshot();
      await snapshot.run(async () => {
        expect(required(await left(`${canonical}|7.0.0`))).toBe(0);
        expect(required(await right(`${canonical}|7.0.0`))).toBe(1);
        expect(required(await left(`${canonical}|7.0.0`))).toBe(0);
      });
    });

    it(`${api} respects canonical pin changes and keeps an unavailable selected edition missing`, async () => {
      const sdLoader = await loader(await store(0, ['7.0.0', '8.0.0']));
      const read = reader(sdLoader, api), snapshot = createValidationDependencySnapshot();
      await snapshot.run(async () => {
        sdLoader.setPinnedCanonicals(new Map([[canonical, `${canonical}|7.0.0`]]));
        expect(required(await read())).toBe(0);
        sdLoader.setPinnedCanonicals(new Map([[canonical, `${canonical}|8.0.0`]]));
        expect(required(await read())).toBe(1);
        sdLoader.setPinnedCanonicals(new Map([[canonical, ` ${canonical}|8.0.0`]]));
        expect(await read()).toBeNull();
        sdLoader.setPinnedCanonicals(new Map([[canonical, '']]));
        expect(await read()).toBeNull();
        sdLoader.setPinnedCanonicals(new Map([[canonical, `${canonical}|9.0.0`]]));
        expect(await read()).toBeNull();
        expect(required(await read(`${canonical}|7.0.0`))).toBe(0);
        sdLoader.setPinnedCanonicals(new Map([[canonical, `${canonical}|7.0.0`]]));
        expect(required(await read())).toBe(0);
      });
    });

    it(`${api} sees replacement external definitions with the same canonical and version`, async () => {
      const sdLoader = await loader(await store(0));
      const read = reader(sdLoader, api), snapshot = createValidationDependencySnapshot();
      await snapshot.run(async () => {
        expect(sdLoader.registerExternalProfile(definition(1))).toBe(true);
        expect(required(await read())).toBe(1);
        expect(sdLoader.registerExternalProfile(definition(0))).toBe(true);
        expect(required(await read())).toBe(0);
        sdLoader.clearExternalProfiles();
        expect(required(await read(`${canonical}|7.0.0`))).toBe(0);
      });
    });

    it(`${api} stops reusing a replaced host source through both capture and warm loader cache`, async () => {
      const sdLoader = await loader(await store(9));
      const read = reader(sdLoader, api), snapshot = createValidationDependencySnapshot();
      const first = vi.fn(async () => definition(0)), second = vi.fn(async () => definition(1));
      await snapshot.run(async () => {
        setProfileSource({ findByUrl: first }); expect(required(await read())).toBe(0);
        setProfileSource({ findByUrl: second }); expect(required(await read())).toBe(1);
      });
      expect(required(await read())).toBe(1);
      expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    });
  }

  it('binds a held host proxy to the source installation that supplied it', async () => {
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      const left = vi.fn(async () => definition(0)), right = vi.fn(async () => definition(1));
      setProfileSource({ resolveProfile: left }); const held = getProfileSource();
      expect(required(await held.resolveProfile!(canonical, undefined, undefined))).toBe(0);
      setProfileSource({ resolveProfile: right });
      expect(required(await getProfileSource().resolveProfile!(canonical, undefined, undefined))).toBe(1);
      expect(required(await held.resolveProfile!(canonical, undefined, undefined))).toBe(0);
      expect(left).toHaveBeenCalledTimes(1); expect(right).toHaveBeenCalledTimes(1);
    });
  });

  it('binds the initiating host before the unscoped pipeline resumes', async () => {
    const sdLoader = await loader(await store(9));
    const snapshot = createValidationDependencySnapshot();
    const first = vi.fn(async () => definition(0)), second = vi.fn(async () => definition(1));
    await snapshot.run(async () => {
      setProfileSource({ findByUrl: first }); const pending = sdLoader.loadProfile(canonical);
      setProfileSource({ findByUrl: second });
      expect(required(await pending)).toBe(0);
      expect(required(await sdLoader.loadProfile(canonical))).toBe(1);
    });
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested' });
  });

  it.each([false, true])('separates a nested old host binding from a new global host (%s)', async capture => {
    const sdLoader = await loader(await store(9)), trigger = `${canonical}Trigger`;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    setProfileSource({ findByUrl: async url => {
      if (url === trigger) {
        entered(); await gate;
        return { ...definition(required(await sdLoader.loadProfile(canonical))!), url: trigger };
      }
      return definition(0);
    } });
    const snapshot = createValidationDependencySnapshot();
    const execute = async () => {
      const old = sdLoader.loadProfile(trigger); await started;
      setProfileSource({ findByUrl: async () => definition(1) });
      expect(required(await sdLoader.loadProfile(canonical))).toBe(1);
      release(); expect(required(await old)).toBe(0);
      expect(required(await sdLoader.loadProfile(canonical))).toBe(1);
    };
    if (capture) await snapshot.run(execute); else await execute();
    if (capture) expect(snapshot.evidence()).toMatchObject({ status: 'unattested' });
  });

  it('binds asynchronous host follow-ups in a direct tenant override', async () => {
    const sdLoader = await loader(await store(9)), generator = new SnapshotGenerator(sdLoader);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    setProfileSource({ findByUrl: async () => definition(0), resolveProfile: async () => {
      entered(); await gate;
      return getProfileSource().findByUrl!(canonical);
    } });
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      const old = loadProfileForValidation(sdLoader, generator, canonical, 'R4', undefined, undefined, { organizationId: 1 });
      await started; setProfileSource({ findByUrl: async () => definition(1) });
      release(); expect(required(await old)).toBe(0);
    });
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested' });
  });

  it('binds pending lookup inputs before a following scope change', async () => {
    const sdLoader = await loader(await store(9));
    const resolveProfile = vi.fn<NonNullable<ProfileSource['resolveProfile']>>(async (_url, _version, _settings, context) => definition(context!.organizationId!));
    setProfileSource({ resolveProfile });
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      sdLoader.setProfileResolutionContext({ organizationId: 1 });
      const pending = sdLoader.loadProfile(canonical);
      sdLoader.setProfileResolutionContext({ organizationId: 2 });
      expect(required(await pending)).toBe(1);
      expect(required(await sdLoader.loadProfile(canonical))).toBe(2);
    });
    expect(resolveProfile.mock.calls.map(call => call[3]!.organizationId)).toEqual([1, 2]);
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested', reason: expect.stringContaining('owner changed') });
  });

  it('does not join an old-policy pending filesystem lookup after a policy change', async () => {
    const sdLoader = await loader(await store(0, ['7.0.0', '8.0.0']));
    const read = reader(sdLoader, 'direct'), snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      sdLoader.setPackageVersionPins({ 'example.scope': '1.0.0' });
      const old = read();
      sdLoader.setPackageVersionPins({ 'example.scope': '2.0.0' });
      const current = read();
      expect(required(await old)).toBe(0);
      expect(required(await current)).toBe(1);
      expect(required(await read())).toBe(1);
    });
    expect(snapshot.evidence()).toMatchObject({ status: 'unattested' });
  });

  it('keeps equal re-applied settings within the same private reuse scope', async () => {
    const sdLoader = await loader(await store(0));
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    sdLoader.setProfileResolutionContext({ organizationId: 1 }, settings);
    const scope = sdLoader.getDependencyCaptureScope();
    sdLoader.setProfileResolutionContext({ organizationId: 1 }, structuredClone(settings));
    expect(sdLoader.getDependencyCaptureScope()).toBe(scope);
  });

  it('copies host resolution settings and tenant scope supplied by the caller', async () => {
    const sdLoader = await loader(await store(9));
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4), context = { organizationId: 1 };
    const resolveProfile = vi.fn<NonNullable<ProfileSource['resolveProfile']>>(async () => definition(0)); setProfileSource({ resolveProfile });
    sdLoader.setProfileResolutionContext(context, settings);
    const original = structuredClone(settings);
    settings.advisorRules = []; settings.performance.batchSize = 123; context.organizationId = 2;
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(() => sdLoader.loadProfile(canonical));
    expect(resolveProfile.mock.calls[0][2]).toEqual(original);
    expect(resolveProfile.mock.calls[0][3]).toMatchObject({ organizationId: 1 });
  });
});
