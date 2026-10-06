import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCanonicalPinCaches } from '../package/canonical-pin-context';
import {
  recordProfilePackageProvenance,
} from '../package/canonical-pin-provenance';
import { pinProfileReference } from './profile-reference-pins';

// Mirrors ISiP 1.0.2 -> ISiK Basismodul 2.0.x -> Basisprofil DE 1.4.0: the
// ISiP profile's own package declares ISiK 2.0.4 while only 2.0.0 is
// installed, and Basisprofil 1.4.0 is reachable only through ISiK.
const ISIP_PROFILE = 'http://example.org/isip/StructureDefinition/Pflegeempfaenger';
const ISIK_V2_PROFILE = 'http://example.org/isik/v2/StructureDefinition/Patient';
const KVID_PROFILE = 'http://example.org/basis/StructureDefinition/identifier-kvid-10';
const ISIP_SOURCE = { url: ISIP_PROFILE, version: '1.0.2' };

describe('pinProfileReference', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearCanonicalPinCaches();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createIsipStore(
    options: { basisReleases?: string[]; isikIndex?: PackageIndex } = {},
  ): Promise<string> {
    const store = await mkdtemp(path.join(tmpdir(), 'profile-reference-pins-'));
    tempDirs.push(store);
    await writePackage(store, 'example.isip', '1.0.2', { 'example.isik': '2.0.4' }, [
      { url: ISIP_PROFILE, version: '1.0.2' },
    ]);
    // Older IG packages ship no .index.json; their resource files are read.
    await writePackage(store, 'example.isik', '2.0.0', { 'example.basis': '1.4.0' }, [
      { url: ISIK_V2_PROFILE, version: '2.0.0' },
    ], options.isikIndex ?? 'none');
    await writePackage(store, 'example.isik', '4.0.3', { 'example.basis': '1.5.4' }, []);
    for (const release of options.basisReleases ?? ['1.4.0', '1.5.4']) {
      await writePackage(store, 'example.basis', release, {}, [{ url: KVID_PROFILE, version: release }]);
    }
    recordProfilePackageProvenance(ISIP_SOURCE, 'example.isip#1.0.2');
    return store;
  }

  it('does not replace the unavailable original literal dependency', async () => {
    const store = await createIsipStore();

    await expect(pinProfileReference(ISIK_V2_PROFILE, ISIP_SOURCE, { storeDirs: [store], packageVersionPins: {} }))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError', receipt: { cause: 'dependency-missing' } });
  });

  it('does not read the resource files of a package whose index it cannot use', async () => {
    const store = await createIsipStore({ isikIndex: 'unreadable' });

    await expect(pinProfileReference(ISIK_V2_PROFILE, ISIP_SOURCE, { storeDirs: [store], packageVersionPins: {} }))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });

  it('keeps the original missing literal before a transitive canonical', async () => {
    const store = await createIsipStore();

    await expect(pinProfileReference(KVID_PROFILE, ISIP_SOURCE, { storeDirs: [store], packageVersionPins: {} }))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });

  it('retains unavailable dependency evidence rather than handing a bare canonical on', async () => {
    const store = await createIsipStore({ basisReleases: ['1.5.4'] });

    await expect(pinProfileReference(KVID_PROFILE, ISIP_SOURCE, { storeDirs: [store], packageVersionPins: {} }))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });

  it('follows a host package pin over the declared dependency release', async () => {
    const store = await createIsipStore();

    await expect(pinProfileReference(KVID_PROFILE, ISIP_SOURCE, {
      storeDirs: [store],
      packageVersionPins: { 'example.isik': '2.0.0', 'example.basis': '1.5.4' },
    })).resolves.toBe(`${KVID_PROFILE}|1.5.4`);
  });

  it.each(['2.0.0', '2.0.x'])('resolves a genuine installed exact/range dependency %s', async declared => {
    const store = await createIsipStore();
    await writePackage(store, 'example.isip', '1.0.2', { 'example.isik': declared }, [{ url: ISIP_PROFILE, version: '1.0.2' }]);
    await expect(pinProfileReference(KVID_PROFILE, ISIP_SOURCE, { storeDirs: [store], packageVersionPins: {} }))
      .resolves.toBe(`${KVID_PROFILE}|1.4.0`);
  });

  it('keeps references of a profile without package provenance unversioned', async () => {
    const store = await createIsipStore();

    await expect(pinProfileReference(KVID_PROFILE, { url: ISIP_PROFILE, version: '1.0.2' }, { storeDirs: [store], packageVersionPins: {} }))
      .resolves.toBe(KVID_PROFILE);
    await expect(pinProfileReference(KVID_PROFILE, undefined, { storeDirs: [store], packageVersionPins: {} }))
      .resolves.toBe(KVID_PROFILE);
  });

  it('retains authority for versioned IG references while exempting core canonicals', async () => {
    const store = await createIsipStore();
    const scope = { storeDirs: [store], packageVersionPins: {} };

    await expect(pinProfileReference(`${KVID_PROFILE}|1.5.4`, ISIP_SOURCE, scope))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
    await expect(pinProfileReference('http://hl7.org/fhir/StructureDefinition/Patient', ISIP_SOURCE, scope))
      .resolves.toBe('http://hl7.org/fhir/StructureDefinition/Patient');
  });
});

type PackageIndex = 'valid' | 'none' | 'unreadable';

async function writePackage(
  store: string,
  name: string,
  version: string,
  dependencies: Record<string, string>,
  profiles: Array<{ url: string; version: string }>,
  index: PackageIndex = 'valid',
): Promise<void> {
  const packageDir = path.join(store, `${name}#${version}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name,
    version,
    fhirVersions: ['4.0.1'],
    dependencies: { 'hl7.fhir.r4.core': '4.0.1', ...dependencies },
  }));
  const files = profiles.map((profile, position) => ({
    filename: `StructureDefinition-${position}.json`,
    resource: { resourceType: 'StructureDefinition', url: profile.url, version: profile.version },
  }));
  for (const file of files) {
    await writeFile(path.join(packageDir, file.filename), JSON.stringify(file.resource));
  }
  if (index === 'none') return;
  await writeFile(path.join(packageDir, '.index.json'), index === 'unreadable' ? '{"files": [' : JSON.stringify({
    'index-version': 2,
    files: files.map(file => ({ filename: file.filename, resourceType: 'StructureDefinition', ...file.resource })),
  }));
}
