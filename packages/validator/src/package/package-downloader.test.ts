import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageDownloader } from './package-downloader';

describe('PackageDownloader local cache resolution', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function writeInstalledPackage(cacheRoot: string, packageDirName: string, manifestName: string): Promise<void> {
    const packageDir = path.join(cacheRoot, packageDirName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: manifestName,
        version: packageDirName.split('#')[1],
        fhirVersions: ['4.0.1'],
      }),
    );
  }

  it('uses an already installed exact package before querying registries', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.eu.eps.r4#1.0.0-xtehr', 'hl7.fhir.eu.eps.r4');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.eu.eps.r4', '1.0.0-xtehr');

    expect(result).toMatchObject({
      success: true,
      packageId: 'hl7.fhir.eu.eps.r4',
      version: '1.0.0-xtehr',
    });
    expect(result.path).toContain('hl7.fhir.eu.eps.r4#1.0.0-xtehr');
  });

  it('uses an installed FHIR-version-suffixed package for the unsuffixed IG id', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.eu.eps.r4#1.0.0-xtehr', 'hl7.fhir.eu.eps.r4');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.eu.eps', '1.0.0-xtehr');

    expect(result).toMatchObject({
      success: true,
      packageId: 'hl7.fhir.eu.eps.r4',
      version: '1.0.0-xtehr',
    });
  });
});
