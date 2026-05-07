import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCacheDirectory, scanPackageDirectory } from './sd-loader-package-scanner';

describe('scanCacheDirectory package version pins', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function addPackage(root: string, packageName: string, profileUrl: string): Promise<void> {
    const packageDir = join(root, packageName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'StructureDefinition-test.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: profileUrl
      })
    );
  }

  it('scans the pinned package version instead of the newest installed version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    tempDirs.push(root);
    await addPackage(root, 'de.basisprofil.r4#1.5.4', 'http://example.org/pinned');
    await addPackage(root, 'de.basisprofil.r4#1.6.0-ballot2', 'http://example.org/latest');

    const availableProfiles = new Set<string>();
    const scanned = await scanCacheDirectory(root, availableProfiles, {
      packageVersionPins: {
        'de.basisprofil.r4': '1.5.4'
      }
    });

    expect(scanned).toBe(1);
    expect(availableProfiles.has('http://example.org/pinned')).toBe(true);
    expect(availableProfiles.has('http://example.org/latest')).toBe(false);
  });

  it('skips local unpinned versions when the pinned version is not installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    tempDirs.push(root);
    await addPackage(root, 'de.basisprofil.r4#1.6.0-ballot2', 'http://example.org/latest');

    const availableProfiles = new Set<string>();
    const scanned = await scanCacheDirectory(root, availableProfiles, {
      packageVersionPins: {
        'de.basisprofil.r4': '1.5.4'
      }
    });

    expect(scanned).toBe(0);
    expect(availableProfiles.size).toBe(0);
  });

  it('accepts package JSON files with a UTF-8 BOM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    tempDirs.push(root);
    await writeFile(
      join(root, 'StructureDefinition-bom.json'),
      `\uFEFF${JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://example.org/bom-profile'
      })}`
    );

    const availableProfiles = new Set<string>();
    await scanPackageDirectory(root, availableProfiles);

    expect(availableProfiles.has('http://example.org/bom-profile')).toBe(true);
  });
});
