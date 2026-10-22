import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePackageFileReads } from './fixtures/package-file-read-observer';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';
import { createValidationDependencySnapshot, captureValidationDependency, withBatchProfileMetadataCache,
  withProfileReferenceInventorySnapshot } from '../../validation-dependency-snapshot';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { clearProfileReferenceFallbackCatalog, readFallbackInventory } from '../profile-reference-fallback-catalog';
import { setProfileSource } from '../../persistence/profile-source';

const roots: string[] = [];
const parentUrl = 'https://inventory.test/StructureDefinition/Parent';
const firstUrl = 'https://inventory.test/StructureDefinition/First';
const secondUrl = 'https://inventory.test/StructureDefinition/Second';
const definition = (url: string, min = 0): StructureDefinition => ({ resourceType: 'StructureDefinition',
  url, version: '7.0.0', fhirVersion: '4.0.1', name: 'InventoryPatient', type: 'Patient',
  status: 'active', abstract: false, kind: 'resource', snapshot: { element: [
    { id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.active', path: 'Patient.active', min, max: '1', type: [{ code: 'boolean' }] },
  ] } });
const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
settings.terminologyServers = []; settings.advisorRules = [];
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource({}); clearCanonicalPinCaches(); clearProfileReferenceFallbackCatalog();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await fs.mkdtemp(join(tmpdir(), 'records-inventory-')); roots.push(root); return fs.realpath(root);
}
async function packageFolder(root: string, name: string, profiles: StructureDefinition[], indexed: boolean, dependencies = {}, release = '1.0.0') {
  const folder = join(root, `${name}#${release}`, 'package'); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(join(folder, 'package.json'), JSON.stringify({ name, version: release, dependencies, fhirVersions: ['4.0.1'] }));
  for (const [position, profile] of profiles.entries()) await fs.writeFile(join(folder, `StructureDefinition-${position}.json`), JSON.stringify(profile));
  if (indexed) await fs.writeFile(join(folder, '.index.json'), JSON.stringify({ files: profiles.map((profile, position) => ({
    resourceType: 'StructureDefinition', url: profile.url, version: profile.version, filename: `StructureDefinition-${position}.json`,
  })) }));
  return folder;
}
async function fixture() {
  const root = await directory();
  await packageFolder(root, 'example.owner', [definition(parentUrl)], true, { 'example.targets': '1.0.0' });
  const targetFolder = await packageFolder(root, 'example.targets', [definition(firstUrl, 0), definition(secondUrl, 1)], false);
  await fs.writeFile(join(targetFolder, '.index.json'), JSON.stringify({ files: [] }));
  await fs.writeFile(join(targetFolder, 'Bundle.json'), JSON.stringify({ resourceType: 'Bundle', entry: [{ marker: 'synthetic' }] }));
  const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
  await loader.waitForInitialization();
  const parent = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
  if (!parent) throw new Error('Actual package parent was not loaded');
  return { root, loader, parent, targetFolder };
}
const min = (profile: StructureDefinition | null) => profile?.snapshot?.element[1].min;
const unavailable = { name: 'ProfileReferenceUnavailableError', receipt: {
  source: { name: 'example.owner', version: '1.0.0' }, dependency: { name: 'example.targets', version: '1.0.0' },
} };

describe('actual profile inventories within one validation request', () => {
  it('keeps the first package read separate from concurrent and later snapshot readers', async () => {
    const { loader, parent } = await fixture();
    await withProfileReferenceInventorySnapshot(async () => {
      const [first, concurrent] = await Promise.all([
        loader.loadReferencedProfile(firstUrl, parent, 'R4'),
        loader.loadReferencedProfile(firstUrl, parent, 'R4'),
      ]);
      expect(min(first)).toBe(0);
      expect(min(concurrent)).toBe(0);
      first!.snapshot!.element[1].min = 7;
      expect(min(concurrent)).toBe(0);
      const later = await loader.loadReferencedProfile(firstUrl, parent, 'R4');
      expect(min(later)).toBe(0);
      later!.snapshot!.element[1].min = 8;
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
    });
    expect(min(await withProfileReferenceInventorySnapshot(() =>
      loader.loadReferencedProfile(firstUrl, parent, 'R4')))).toBe(0);
  });

  it('reuses a complete fallback catalog across requests and clears it with the loader', async () => {
    const { loader, parent, targetFolder } = await fixture();
    const reads = observePackageFileReads();
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(firstUrl, parent, 'R4')))).toBe(0);
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))).toBe(1);
    const count = () => reads.filter(name => resolve(name) === resolve(join(targetFolder, 'Bundle.json'))).length;
    expect(count()).toBe(1);
    loader.clearCache();
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(firstUrl, parent, 'R4')))).toBe(0);
    expect(count()).toBe(2);
  });

  it('keeps callback-batch scans separate from the cross-batch catalog', async () => {
    const { loader, parent, targetFolder } = await fixture();
    const reads = observePackageFileReads();
    expect(min(await withBatchProfileMetadataCache(() => withProfileReferenceInventorySnapshot(() =>
      loader.loadReferencedProfile(firstUrl, parent, 'R4'))))).toBe(0);
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))).toBe(1);
    const count = reads.filter(name => resolve(name) === resolve(join(targetFolder, 'Bundle.json'))).length;
    expect(count).toBe(2);
  });

  it('does not repopulate a cleared catalog from a scan already in flight', async () => {
    const { targetFolder } = await fixture();
    const reads = observePackageFileReads();
    const readdir = fs.readdir.bind(fs);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolveEntered => { enter = resolveEntered; });
    const blocked = new Promise<void>(resolveBlocked => { release = resolveBlocked; });
    let delayed = false;
    vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      const result = await readdir(...args);
      if (!delayed && resolve(String(args[0])) === resolve(targetFolder)) {
        delayed = true;
        enter();
        await blocked;
      }
      return result;
    });
    const first = readFallbackInventory(targetFolder);
    await entered;
    clearProfileReferenceFallbackCatalog();
    release();
    expect((await first).status).toBe('read');
    expect((await readFallbackInventory(targetFolder)).status).toBe('read');
    expect(reads.filter(name => resolve(name) === resolve(join(targetFolder, 'Bundle.json')))).toHaveLength(2);
  });

  it('rebuilds the catalog after in-place content changes or new unindexed files', async () => {
    const { loader, parent, targetFolder } = await fixture();
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(firstUrl, parent, 'R4')))).toBe(0);
    await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))).toBe(0);
    const addedUrl = 'https://inventory.test/StructureDefinition/Added';
    await fs.writeFile(join(targetFolder, 'StructureDefinition-added.json'), JSON.stringify(definition(addedUrl, 1)));
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(addedUrl, parent, 'R4')))).toBe(1);
    await fs.writeFile(join(targetFolder, 'broken.json'), '{broken');
    await expect(withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile('https://inventory.test/absent', parent, 'R4')))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError', receipt: { cause: 'resource-unreadable' } });
  });
  it('shares an index-miss scan for distinct canonicals, preserves actual P/N and detaches returned definitions', async () => {
    const { loader, parent, targetFolder } = await fixture();
    const reads = observePackageFileReads(); const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      const first = await loader.loadReferencedProfile(firstUrl, parent, 'R4'); expect(min(first)).toBe(0);
      first!.snapshot!.element[1].min = 9;
      expect(min(await loader.loadReferencedProfile(secondUrl, parent, 'R4'))).toBe(1);
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
    });
    const count = (file: string) => reads.filter(name => resolve(name) === resolve(join(targetFolder, file))).length;
    expect(count('Bundle.json')).toBe(1);
    expect(count('.index.json')).toBe(1);
    expect(count('StructureDefinition-0.json')).toBe(2);
    expect(count('StructureDefinition-1.json')).toBe(2);
    expect(snapshot.evidence().status).toBe('captured');
  });
  it('returns typed unknown for changed selected bytes with equal identity, and reads the change in a fresh request', async () => {
    const { loader, parent, targetFolder } = await fixture(); const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
      await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
      await expect(loader.loadReferencedProfile(secondUrl, parent, 'R4')).rejects.toMatchObject({
        ...unavailable, receipt: { ...unavailable.receipt, cause: 'source-changed' },
      });
    });
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))).toBe(0);
  });
  it('keeps a selected file change visible as unknown across resources sharing batch metadata', async () => {
    const { loader, parent, targetFolder } = await fixture();
    await withBatchProfileMetadataCache(async () => {
      expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(firstUrl, parent, 'R4')))).toBe(0);
      await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
      await expect(withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))
        .rejects.toMatchObject({ ...unavailable, receipt: { ...unavailable.receipt, cause: 'source-changed' } });
    });
    expect(min(await withProfileReferenceInventorySnapshot(() => loader.loadReferencedProfile(secondUrl, parent, 'R4')))).toBe(0);
  });
  it('keeps targeted index hits independent of malformed unindexed files while an index miss remains unknown', async () => {
    const { loader, parent, targetFolder } = await fixture();
    await fs.writeFile(join(targetFolder, '.index.json'), JSON.stringify({ files: [{ resourceType: 'StructureDefinition',
      url: firstUrl, version: '7.0.0', filename: 'StructureDefinition-0.json' }] }));
    await fs.writeFile(join(targetFolder, 'broken.json'), '{broken');
    await createValidationDependencySnapshot().run(async () => {
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
      await expect(loader.loadReferencedProfile(secondUrl, parent, 'R4')).rejects.toMatchObject({
        ...unavailable, receipt: { ...unavailable.receipt, cause: 'resource-unreadable' },
      });
    });
  });
  it.each([false, true])('refuses to rebase a package-directory symlink after captured files (indexed=%s)', async indexed => {
    const { loader, parent, root, targetFolder } = await fixture();
    if (indexed) await fs.writeFile(join(targetFolder, '.index.json'), JSON.stringify({ files: [firstUrl, secondUrl].map((url, position) => ({
      resourceType: 'StructureDefinition', url, version: '7.0.0', filename: `StructureDefinition-${position}.json`,
    })) }));
    const oldFolder = join(root, 'old-targets'); const replacement = await directory();
    await fs.writeFile(join(replacement, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
    await createValidationDependencySnapshot().run(async () => {
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
      await fs.rename(targetFolder, oldFolder); await fs.symlink(replacement, targetFolder, 'dir');
      await expect(loader.loadReferencedProfile(secondUrl, parent, 'R4')).rejects.toMatchObject({
        ...unavailable, receipt: { ...unavailable.receipt, cause: 'source-changed' },
      });
    });
  });
  it('refuses a cached example directory retargeted outside its original package before a different canonical lookup', async () => {
    const { loader, parent, targetFolder } = await fixture();
    await fs.rm(join(targetFolder, 'StructureDefinition-0.json')); await fs.rm(join(targetFolder, 'StructureDefinition-1.json'));
    const example = join(targetFolder, 'example'); await fs.mkdir(example);
    await fs.writeFile(join(example, '.index.json'), JSON.stringify({ files: [{ resourceType: 'StructureDefinition',
      url: firstUrl, filename: 'StructureDefinition-0.json' }] }));
    await fs.writeFile(join(example, 'StructureDefinition-0.json'), JSON.stringify(definition(firstUrl)));
    const foreign = await directory(); await fs.writeFile(join(foreign, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl)));
    await createValidationDependencySnapshot().run(async () => {
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
      await fs.rm(example, { recursive: true }); await fs.symlink(foreign, example, 'dir');
      await expect(loader.loadReferencedProfile(secondUrl, parent, 'R4')).rejects.toMatchObject({
        ...unavailable, receipt: { ...unavailable.receipt, cause: 'source-changed' },
      });
    });
  });
  it('separates new loader owners within an explicit snapshot', async () => {
    const { loader, parent, targetFolder } = await fixture();
    await createValidationDependencySnapshot().run(async () => {
      expect(min(await loader.loadReferencedProfile(firstUrl, parent, 'R4'))).toBe(0);
      await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
      loader.setPackageVersionPins({ 'example.targets': '1.0.0' });
      expect(min(await loader.loadReferencedProfile(secondUrl, parent, 'R4'))).toBe(0);
    });
  });
  it.each(['single', 'multi'] as const)('creates fresh resource captures for public %s calls and retains an explicit outer capture', async api => {
    const { root, targetFolder } = await fixture();
    const core = { ...definition('http://hl7.org/fhir/StructureDefinition/Patient'), version: '4.0.1' };
    const coreFolder = await packageFolder(root, 'hl7.fhir.r4.core', [core], true, {}, '4.0.1');
    await fs.rename(join(coreFolder, 'StructureDefinition-0.json'), join(coreFolder, 'StructureDefinition-Patient.json'));
    await fs.writeFile(join(coreFolder, '.index.json'), JSON.stringify({ files: [{ resourceType: 'StructureDefinition',
      url: core.url, version: core.version, filename: 'StructureDefinition-Patient.json' }] }));
    const parentFolder = join(root, 'example.owner#1.0.0', 'package');
    const parent = { ...definition(parentUrl), baseDefinition: secondUrl, snapshot: undefined,
      differential: { element: [{ id: 'Patient', path: 'Patient' }] } };
    await fs.writeFile(join(parentFolder, 'StructureDefinition-0.json'), JSON.stringify(parent));
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, enableCaching: false, terminologyPackageDirectories: [] });
    await validator.waitForInitialization();
    const run = async () => {
      const resource = { resourceType: 'Patient' };
      return api === 'single' ? validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
        : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], profileUrl: `${parentUrl}|7.0.0`,
          settings, fhirVersion: 'R4' })).aspects.flatMap(aspect => aspect.issues);
    };
    const hasMin = (issues: Awaited<ReturnType<typeof run>>) => issues.some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active');
    const hasUnknown = (issues: Awaited<ReturnType<typeof run>>) => issues.some(issue => issue.details?.validationComplete === false);
    for (const requirement of [1, 0, 'broken', 1] as const) {
      await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), requirement === 'broken' ? '{broken' : JSON.stringify(definition(secondUrl, requirement)));
      const issues = await run(); expect(hasMin(issues)).toBe(requirement === 1); expect(hasUnknown(issues)).toBe(requirement === 'broken');
    }
    await createValidationDependencySnapshot().run(async () => {
      expect(hasMin(await run())).toBe(true);
      await fs.writeFile(join(targetFolder, 'StructureDefinition-1.json'), JSON.stringify(definition(secondUrl, 0)));
      expect(hasMin(await run())).toBe(true);
    });
    expect(hasMin(await run())).toBe(false);
  });
  it('keeps root operation captures isolated while an explicitly supplied snapshot keeps its evidence and limits', async () => {
    const read = () => captureValidationDependency('profile', 'resource-boundary-control', 'same', async () => ({ marker: ++sequence }));
    let sequence = 0;
    const calls = await Promise.all([withProfileReferenceInventorySnapshot(read), withProfileReferenceInventorySnapshot(read)]);
    expect(calls.map(call => call.marker).sort()).toEqual([1, 2]);
    const outer = createValidationDependencySnapshot();
    await outer.run(async () => {
      expect(await withProfileReferenceInventorySnapshot(read)).toEqual({ marker: 3 });
      expect(await withProfileReferenceInventorySnapshot(read)).toEqual({ marker: 3 });
    });
    expect(outer.evidence()).toMatchObject({ status: 'captured', profileCount: 1 });
  });
  it('leaves ordinary profile and terminology lookups outside the implicit inventory capture', async () => {
    let sequence = 0;
    const read = (kind: 'profile' | 'terminology') => captureValidationDependency(kind,
      kind === 'profile' ? 'load-profile' : 'loadCodeSystem', 'same', async () => ({ marker: ++sequence }));
    await withProfileReferenceInventorySnapshot(async () => {
      expect(await read('profile')).toEqual({ marker: 1 }); expect(await read('profile')).toEqual({ marker: 2 });
      expect(await read('terminology')).toEqual({ marker: 3 }); expect(await read('terminology')).toEqual({ marker: 4 });
    });
    const outer = createValidationDependencySnapshot();
    await outer.run(async () => {
      expect(await withProfileReferenceInventorySnapshot(() => read('terminology'))).toEqual({ marker: 5 });
      expect(await withProfileReferenceInventorySnapshot(() => read('terminology'))).toEqual({ marker: 5 });
    });
    expect(outer.evidence()).toMatchObject({ status: 'unattested', terminologyCount: 1, profileCount: 0 });
  });
  it('retains the explicit entry limit and fails visibly instead of truncating dependencies', async () => {
    const outer = createValidationDependencySnapshot();
    await outer.run(async () => {
      for (let key = 0; key < 4096; key++) await captureValidationDependency('profile', 'inventory-limit-control', key, async () => key);
      await expect(withProfileReferenceInventorySnapshot(() => captureValidationDependency('profile',
        'inventory-limit-control', 4096, async () => 4096))).rejects.toThrow('Validation dependency snapshot is too large');
    });
    expect(outer.evidence()).toMatchObject({ status: 'unattested', profileCount: 4096, reason: expect.stringContaining('entry limit') });
  });

});
