import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProfilePinToCanonical, clearCanonicalPinCaches, derivePackagePinContext, resolvePinnedCanonicalSource } from './canonical-pin-context';
import { recordProfilePackageProvenance } from './canonical-pin-provenance';
import { withPinnedCanonicalSource } from './canonical-pin-scope';
import { rankedDeclarationsForCanonical } from '../validators/valueset-package-declaration-search';
import { clearPackageCanonicalIndex, findResourceInPackages } from '../validators/valueset-package-search';

// ISiK binds IHE-D's format codes. IHE-D's terminology package ships no
// .index.json, and old de.basisprofil releases carry a stale copy of the same
// ValueSet under the same url and version.
const PROFILE = 'https://gematik.de/fhir/isik/StructureDefinition/ISiKDokumentenMetadaten';
const sourceProfile = { url: PROFILE, version: '5.1.0' };
const FORMAT_CODES = 'http://ihe-d.de/ValueSets/IHEXDSformatCodeDE';
const VERSION = '2018-12-14T17:07:12';

describe('the package a dependency pin chose', () => {
  let store: string;

  beforeEach(async () => {
    clearPackageCanonicalIndex();
    store = await mkdtemp(path.join(tmpdir(), 'pinned-source-'));
    await writePackage('de.gematik.isik', '5.1.0', { 'de.ihe-d.terminology': '3.0.1' }, [
      { file: 'StructureDefinition-ISiKDokumentenMetadaten.json', resource: { resourceType: 'StructureDefinition', url: PROFILE, version: '5.1.0' } },
    ]);
    await writePackage('de.basisprofil.r4', '1.4.0', {}, [
      { file: 'ValueSet-1.2.276.0.76.11.35.json', resource: valueSet('stale') },
    ]);
    await writePackage('de.ihe-d.terminology', '3.0.1', {}, [
      { file: 'IHEXDSformatCodeDE.json', resource: valueSet('current') },
    ], false);
    recordProfilePackageProvenance(sourceProfile, 'de.gematik.isik#5.1.0');
  });

  afterEach(async () => {
    clearCanonicalPinCaches();
    clearPackageCanonicalIndex();
    await rm(store, { recursive: true, force: true });
  });

  it('pins a canonical that a dependency without an index ships', async () => {
    await expect(applyProfilePinToCanonical([store], sourceProfile, FORMAT_CODES, 'R4'))
      .resolves.toBe(`${FORMAT_CODES}|${VERSION}`);
  });

  it('reads that package’s copy of a url and version other packages ship too', async () => {
    const context = await derivePackagePinContext([store], { name: 'de.gematik.isik', version: '5.1.0' });
    const pin = await resolvePinnedCanonicalSource([store], context!, FORMAT_CODES, 'R4');
    await withPinnedCanonicalSource(pin!, async () => {

    const ranked = await rankedDeclarationsForCanonical([store], 'ValueSet', FORMAT_CODES, undefined, VERSION);
    expect(ranked?.[0]?.declaration.packageName).toBe('de.ihe-d.terminology#3.0.1');
    await expect(findResourceInPackages<{ title?: string }>(
      [store], FORMAT_CODES, ['ValueSet-1.2.276.0.76.11.35.json', 'IHEXDSformatCodeDE.json'], undefined, VERSION,
    )).resolves.toMatchObject({ title: 'current' });
    });
  });

  function valueSet(title: string): Record<string, unknown> {
    return { resourceType: 'ValueSet', url: FORMAT_CODES, version: VERSION, title };
  }

  async function writePackage(
    name: string,
    version: string,
    dependencies: Record<string, string>,
    files: Array<{ file: string; resource: Record<string, unknown> }>,
    indexed = true,
  ): Promise<void> {
    const packageDir = path.join(store, `${name}#${version}`, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }));
    for (const { file, resource } of files) await writeFile(path.join(packageDir, file), JSON.stringify(resource));
    if (indexed) {
      await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
        'index-version': 2,
        files: files.map(({ file, resource }) => ({ filename: file, resourceType: resource.resourceType, url: resource.url, version: resource.version })),
      }));
    }
  }
});
