import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareVersions,
  parsePackageName,
  scanCacheDirectory,
  scanPackageDirectory,
} from './sd-loader-package-scanner';

describe('scanCacheDirectory package version pins', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  /** Package releases the scan selected, as opposed to older ones it only indexes. */
  async function selectedPackages(root: string): Promise<string[]> {
    const index = JSON.parse(await readFile(join(root, 'sdloader-profile-index.json'), 'utf-8'));
    return index.packages.map((pkg: { name: string }) => pkg.name);
  }

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

  it('selects numeric prerelease identifiers deterministically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    tempDirs.push(root);
    await addPackage(root, 'example.fhir#1.0.0-beta.2', 'http://example.org/beta-2');
    await addPackage(root, 'example.fhir#1.0.0-beta.10', 'http://example.org/beta-10');

    const availableProfiles = new Set<string>();
    await scanCacheDirectory(root, availableProfiles);

    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(availableProfiles.has('http://example.org/beta-10')).toBe(true);
    await expect(selectedPackages(root)).resolves.toEqual(['example.fhir#1.0.0-beta.10']);
  });

  it('does not treat inherited object properties as package pins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    tempDirs.push(root);
    await addPackage(root, 'example.fhir#1.0.0', 'http://example.org/old');
    await addPackage(root, 'example.fhir#2.0.0', 'http://example.org/latest');
    const inheritedPins = Object.create({ 'example.fhir': '1.0.0' }) as Record<string, string>;

    const availableProfiles = new Set<string>();
    await scanCacheDirectory(root, availableProfiles, { packageVersionPins: inheritedPins });

    expect(availableProfiles.has('http://example.org/latest')).toBe(true);
    await expect(selectedPackages(root)).resolves.toEqual(['example.fhir#2.0.0']);
  });

  it('rejects malformed package names and ignores oversized files and symlinks', async () => {
    expect(parsePackageName('example.fhir#')).toBeNull();
    expect(parsePackageName('#1.0.0')).toBeNull();
    expect(parsePackageName('example.fhir#1.0.0#extra')).toBeNull();

    const root = await mkdtemp(join(tmpdir(), 'records-sd-scan-'));
    const outside = await mkdtemp(join(tmpdir(), 'records-sd-outside-'));
    tempDirs.push(root, outside);
    const oversized = join(root, 'StructureDefinition-oversized.json');
    await writeFile(oversized, '');
    await truncate(oversized, 33 * 1024 * 1024);
    const outsideFile = join(outside, 'StructureDefinition-outside.json');
    await writeFile(outsideFile, JSON.stringify({
      resourceType: 'StructureDefinition',
      url: 'http://example.org/outside',
    }));
    await symlink(outsideFile, join(root, 'StructureDefinition-link.json'));

    const availableProfiles = new Set<string>();
    await scanPackageDirectory(root, availableProfiles);

    expect(availableProfiles.size).toBe(0);
  });
});
