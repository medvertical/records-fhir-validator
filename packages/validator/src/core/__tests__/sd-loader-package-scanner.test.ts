import { cp, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCacheDirectory, scanPackageDirectory } from '../sd-loader-package-scanner';

describe('sd-loader-package-scanner', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('indexes versioned canonical aliases for local StructureDefinitions', async () => {
    const packageDir = await mkdtemp(path.join(tmpdir(), 'sd-loader-package-'));
    tempDirs.push(packageDir);

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-mii-pr-patho-attached-image.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image',
        version: '2026.0.0',
        fhirVersion: '4.0.1',
        type: 'Media',
      }),
    );

    const availableProfiles = new Set<string>();
    await scanPackageDirectory(packageDir, availableProfiles);

    expect(availableProfiles.has(
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image',
    )).toBe(true);
    expect(availableProfiles.has(
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image|2026.0.0',
    )).toBe(true);
  });

  it('keeps the persistent index valid for deduplicated skipped package versions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sd-loader-cache-'));
    tempDirs.push(root);

    const oldProfile = 'http://example.org/fhir/StructureDefinition/old-profile';
    const latestProfile = 'http://example.org/fhir/StructureDefinition/latest-profile';
    await writeStructureDefinition(root, 'example.fhir.package#1.0.0', 'StructureDefinition-old.json', oldProfile);
    const latestFile = await writeStructureDefinition(
      root,
      'example.fhir.package#2.0.0',
      'StructureDefinition-latest.json',
      latestProfile,
    );

    const externalProfile = 'http://example.org/fhir/StructureDefinition/external-profile';
    const firstProfiles = new Set<string>([externalProfile]);
    const firstScanned = await scanCacheDirectory(root, firstProfiles);

    expect(firstScanned).toBe(1);
    expect(firstProfiles.has(latestProfile)).toBe(true);
    // Deduplication scans the newest release; the older one stays indexed.
    expect(firstProfiles.has(oldProfile)).toBe(true);

    const index = JSON.parse(await readFile(path.join(root, 'sdloader-profile-index.json'), 'utf-8'));
    expect(index.packages.map((pkg: { name: string }) => pkg.name)).toEqual(['example.fhir.package#2.0.0']);
    expect(index.sourcePackages.map((pkg: { name: string }) => pkg.name).sort()).toEqual([
      'example.fhir.package#1.0.0',
      'example.fhir.package#2.0.0',
    ]);
    expect(index.sourcePackages.every((pkg: { manifestHash: string }) => (
      /^[a-f0-9]{64}$/.test(pkg.manifestHash)
    ))).toBe(true);
    expect(index.profileUrls).toContain(latestProfile);
    expect(index.profileUrls).not.toContain(externalProfile);

    await rm(latestFile);

    const secondProfiles = new Set<string>();
    await scanCacheDirectory(root, secondProfiles);

    expect(secondProfiles.has(latestProfile)).toBe(true);
    expect(secondProfiles.has(oldProfile)).toBe(true);
  });

  it('keeps a build-time index valid after packages are copied with new mtimes', async () => {
    const buildRoot = await mkdtemp(path.join(tmpdir(), 'sd-loader-build-cache-'));
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'sd-loader-runtime-cache-'));
    tempDirs.push(buildRoot, runtimeRoot);

    const profile = 'http://example.org/fhir/StructureDefinition/copied-profile';
    await writeStructureDefinition(
      buildRoot,
      'example.fhir.package#1.0.0',
      'StructureDefinition-copied.json',
      profile,
    );
    await scanCacheDirectory(buildRoot, new Set<string>());
    await cp(buildRoot, runtimeRoot, { recursive: true });

    const runtimePackageDir = path.join(runtimeRoot, 'example.fhir.package#1.0.0');
    await utimes(runtimePackageDir, new Date('2030-01-01'), new Date('2030-01-01'));
    const indexPath = path.join(runtimeRoot, 'sdloader-profile-index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf-8'));
    await writeFile(indexPath, JSON.stringify({ ...index, generatedAt: 123 }, null, 2));

    const runtimeProfiles = new Set<string>();
    await scanCacheDirectory(runtimeRoot, runtimeProfiles);

    const unchangedIndex = JSON.parse(await readFile(indexPath, 'utf-8'));
    expect(unchangedIndex.generatedAt).toBe(123);
    expect(runtimeProfiles.has(profile)).toBe(true);
  });

  it('invalidates the persistent index when a package manifest changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sd-loader-manifest-cache-'));
    tempDirs.push(root);

    await writeStructureDefinition(
      root,
      'example.fhir.package#1.0.0',
      'StructureDefinition-first.json',
      'http://example.org/fhir/StructureDefinition/first-profile',
    );
    await scanCacheDirectory(root, new Set<string>());

    const secondProfile = 'http://example.org/fhir/StructureDefinition/second-profile';
    await writeStructureDefinition(
      root,
      'example.fhir.package#1.0.0',
      'StructureDefinition-second.json',
      secondProfile,
    );
    await writePackageManifest(root, 'example.fhir.package#1.0.0', 'updated package metadata');

    const rescannedProfiles = new Set<string>();
    await scanCacheDirectory(root, rescannedProfiles);

    expect(rescannedProfiles.has(secondProfile)).toBe(true);
  });
});

async function writeStructureDefinition(
  root: string,
  packageName: string,
  fileName: string,
  url: string,
): Promise<string> {
  const packageDir = path.join(root, packageName, 'package');
  await mkdir(packageDir, { recursive: true });
  await writePackageManifest(root, packageName);
  const filePath = path.join(packageDir, fileName);
  await writeFile(
    filePath,
    JSON.stringify({
      resourceType: 'StructureDefinition',
      url,
      version: '1.0.0',
      fhirVersion: '4.0.1',
      type: 'Patient',
    }),
  );
  return filePath;
}

async function writePackageManifest(
  root: string,
  packageName: string,
  description = 'test package',
): Promise<void> {
  const packageDir = path.join(root, packageName, 'package');
  const [name, version = '0.0.0'] = packageName.split('#');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name, version, description }),
  );
}
