import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lookupProfilePackageProvenance,
} from '../package/canonical-pin-provenance';
import { StructureDefinitionLoader } from './structure-definition-loader';

describe('StructureDefinitionLoader manual IG packages', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('keeps the manually selected package version active after a cache eviction', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-loader-ig-'));
    tempDirs.push(cacheRoot);
    const canonical = 'http://example.org/fhir/StructureDefinition/example-patient';
    await writePackage(cacheRoot, 'example.fhir', '1.0.0', canonical, '1.0.0');
    await writePackage(cacheRoot, 'example.fhir', '2.0.0', canonical, '2.0.0');
    const loader = new StructureDefinitionLoader(cacheRoot, null, {
      autoDownload: false,
      prewarmProfileSource: false,
    });
    await loader.waitForInitialization();

    await loader.loadIGPackage('example.fhir', '1.0.0');
    await expect(loader.loadProfile(canonical, 'R4')).resolves.toMatchObject({
      url: canonical,
      version: '1.0.0',
    });

    loader.clearCache();
    await expect(loader.loadProfile(canonical, 'R4')).resolves.toMatchObject({
      url: canonical,
      version: '1.0.0',
    });
  });

  it('remembers the package a manually loaded profile came from', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-loader-ig-'));
    tempDirs.push(cacheRoot);
    const canonical = 'http://example.org/fhir/StructureDefinition/example-patient';
    await writePackage(cacheRoot, 'example.fhir', '1.0.0', canonical, '1.0.0');
    const loader = new StructureDefinitionLoader(cacheRoot, null, {
      autoDownload: false,
      prewarmProfileSource: false,
    });
    await loader.waitForInitialization();

    await loader.loadIGPackage('example.fhir', '1.0.0');

    const resolved = await loader.loadProfile(canonical, 'R4');
    expect(lookupProfilePackageProvenance(resolved!)).toEqual({ name: 'example.fhir', version: '1.0.0' });
  });
});

async function writePackage(
  cacheRoot: string,
  packageId: string,
  packageVersion: string,
  canonical: string,
  profileVersion: string,
): Promise<void> {
  const packageDir = path.join(cacheRoot, `${packageId}#${packageVersion}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageId, version: packageVersion, fhirVersions: ['4.0.1'] }),
  );
  await writeFile(
    path.join(packageDir, 'StructureDefinition-example.json'),
    JSON.stringify({
      resourceType: 'StructureDefinition',
      id: 'example-patient',
      url: canonical,
      version: profileVersion,
      fhirVersion: '4.0.1',
      type: 'Patient',
      kind: 'resource',
      derivation: 'constraint',
      snapshot: { element: [] },
    }),
  );
}
