import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCanonicalPinCaches } from '../package/canonical-pin-context';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { createValidationDependencySnapshot } from '../validation-dependency-snapshot';

const SOURCE = 'http://example.org/source/StructureDefinition/referrer';
const TARGET = 'http://example.org/target/StructureDefinition/observation';

describe('StructureDefinitionLoader profile references', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearCanonicalPinCaches();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  // The referrer's package depends on target 1.0.0; 2.0.0 is the newest.
  async function loaderOverStore(options: { declaredTargetShipsFile: boolean }) {
    const store = await mkdtemp(path.join(tmpdir(), 'records-loader-reference-pins-'));
    tempDirs.push(store);
    await writePackage(store, 'example.source', '1.0.0', { 'example.target': '1.0.0' }, {
      url: SOURCE, version: '1.0.0', type: 'Patient',
    });
    await writePackage(store, 'example.target', '1.0.0', {}, {
      url: TARGET, version: '1.0.0', type: 'Observation',
    }, { withFile: options.declaredTargetShipsFile });
    await writePackage(store, 'example.target', '2.0.0', {}, {
      url: TARGET, version: '2.0.0', type: 'Observation',
    });
    const loader = new StructureDefinitionLoader(store, null, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization();
    // Reading the referrer from the store records the package it came from.
    const sourceProfile = await loader.loadProfile(SOURCE, 'R4');
    expect(sourceProfile).toMatchObject({ version: '1.0.0' });
    if (!sourceProfile) throw new Error('Fixture source unavailable');
    return { loader, sourceProfile };
  }

  it('hands a referenced canonical on at the release the referrer depends on', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: true });

    await expect(loader.referencedProfileUrl(TARGET, sourceProfile, 'R4')).resolves.toBe(`${TARGET}|1.0.0`);
  });

  it('retains an unavailable indexed file instead of handing a foreign canonical on', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: false });

    await expect(loader.referencedProfileUrl(TARGET, sourceProfile, 'R4')).rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError', receipt: { cause: 'resource-unreadable' } });
  });

  it('does not inspect unrelated referrer content when loading its dependency-pinned target', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: true });
    Object.defineProperty(sourceProfile, 'description', { enumerable: true,
      get: () => { throw new Error('Unrelated referrer content must not be read'); } });

    await expect(loader.loadReferencedProfile(TARGET, sourceProfile, 'R4'))
      .resolves.toMatchObject({ url: TARGET, version: '1.0.0' });
  });

  it('reuses captured target authority when only large unrelated referrer content changes', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: true });
    const snapshot = createValidationDependencySnapshot();
    sourceProfile.description = 'Synthetic referrer metadata'.repeat(20_000);
    await snapshot.run(async () => {
      const first = await loader.loadReferencedProfile(TARGET, sourceProfile, 'R4');
      expect(first?.version).toBe('1.0.0');
      const before = snapshot.evidence().profileCount;
      sourceProfile.description = 'Different synthetic referrer metadata'.repeat(20_000);
      first!.snapshot!.element[0].min = 9;
      const second = await loader.loadReferencedProfile(TARGET, sourceProfile, 'R4');
      expect(second?.version).toBe('1.0.0');
      expect(second?.snapshot?.element[0].min).not.toBe(9);
      expect(snapshot.evidence().profileCount).toBe(before);
    });
    expect(snapshot.evidence().status).toBe('captured');
  });

  it('captures issued referrer identity before a caller mutates it during the asynchronous lookup', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: true });
    const pending = loader.loadReferencedProfile(TARGET, sourceProfile, 'R4');
    sourceProfile.url = 'http://example.org/changed/StructureDefinition/referrer';
    sourceProfile.version = 'changed';

    await expect(pending).resolves.toMatchObject({ url: TARGET, version: '1.0.0' });
  });

  it('knows the resource type of a profile loaded only at its pinned release', async () => {
    const { loader, sourceProfile } = await loaderOverStore({ declaredTargetShipsFile: true });

    await expect(loader.loadReferencedProfile(TARGET, sourceProfile, 'R4')).resolves.toMatchObject({ version: '1.0.0' });
    expect(loader.getBaseResourceType(TARGET)).toBe('Observation');
  });
});

async function writePackage(
  store: string,
  name: string,
  version: string,
  dependencies: Record<string, string>,
  profile: { url: string; version: string; type: string },
  options: { withFile?: boolean } = {},
): Promise<void> {
  const packageDir = path.join(store, `${name}#${version}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name,
    version,
    fhirVersions: ['4.0.1'],
    dependencies: { 'hl7.fhir.r4.core': '4.0.1', ...dependencies },
  }));
  const filename = 'StructureDefinition-profile.json';
  await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
    'index-version': 2,
    files: [{ filename, resourceType: 'StructureDefinition', url: profile.url, version: profile.version }],
  }));
  if (options.withFile === false) return;
  await writeFile(path.join(packageDir, filename), JSON.stringify({
    resourceType: 'StructureDefinition',
    id: `${name}-profile`,
    url: profile.url,
    version: profile.version,
    fhirVersion: '4.0.1',
    type: profile.type,
    kind: 'resource',
    derivation: 'constraint',
    snapshot: { element: [{ id: profile.type, path: profile.type }] },
  }));
}
