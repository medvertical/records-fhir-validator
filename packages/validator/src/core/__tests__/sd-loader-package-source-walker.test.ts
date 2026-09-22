import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanPackageDirectory, walkPackageSource } from '../sd-loader-package-source-walker';

describe('sd-loader package source walker', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('discovers versioned profiles from a complete package index without reading resource payloads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'records-package-index-'));
    tempDirs.push(root);
    await addPackage(root, 'example.fhir#1.0.0', 'http://example.org/profile');
    const packageDir = path.join(root, 'example.fhir#1.0.0', 'package');
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({ files: [{
      filename: 'StructureDefinition-test.json', resourceType: 'StructureDefinition',
      url: 'http://example.org/profile', version: '1.0.0',
    }] }));
    const read = vi.spyOn(fs, 'readFile');
    const profiles = new Set<string>();

    await scanPackageDirectory(packageDir, profiles);

    expect(profiles).toEqual(new Set(['http://example.org/profile', 'http://example.org/profile|1.0.0']));
    expect(read.mock.calls.map(([file]) => path.basename(String(file))))
      .toEqual(['.index.json']);

    const onProfile = vi.fn();
    await scanPackageDirectory(packageDir, new Set(), onProfile);
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'StructureDefinition', url: 'http://example.org/profile', version: '1.0.0',
    }));
  });

  it.each([
    ['malformed', '{'],
    ['incomplete', JSON.stringify({ files: [] })],
    ['invalid profile', JSON.stringify({ files: [{ filename: 'StructureDefinition-test.json', resourceType: 'StructureDefinition' }] })],
  ])('falls back to resource files for a %s package index', async (_name, index) => {
    const root = await mkdtemp(path.join(tmpdir(), 'records-package-index-'));
    tempDirs.push(root);
    await addPackage(root, 'example.fhir#1.0.0', 'http://example.org/profile');
    const packageDir = path.join(root, 'example.fhir#1.0.0', 'package');
    await writeFile(path.join(packageDir, '.index.json'), index);
    const profiles = new Set<string>();

    await scanPackageDirectory(packageDir, profiles);

    expect(profiles).toEqual(new Set(['http://example.org/profile', 'http://example.org/profile|1.0.0']));
  });

  it('discovers, selects, and scans package versions without owning index policy', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'records-package-source-walker-'));
    tempDirs.push(root);
    await addPackage(root, 'example.fhir#1.0.0', 'http://example.org/old');
    await addPackage(root, 'example.fhir#2.0.0', 'http://example.org/latest');
    const availableProfiles = new Set<string>(['http://example.org/external']);

    const result = await walkPackageSource(root, availableProfiles, {
      packageVersionPins: {},
      deduplicateEnabled: true,
    });

    expect(result.scannedCount).toBe(1);
    expect(result.skippedPackageCount).toBe(1);
    expect(result.packageDetails).toEqual([
      { name: 'example.fhir#2.0.0', profileCount: 2 },
    ]);
    expect(result.sourceProfiles).toEqual(new Set([
      'http://example.org/latest',
      'http://example.org/latest|2.0.0',
    ]));
    expect(availableProfiles).toEqual(new Set([
      'http://example.org/external',
      'http://example.org/latest',
      'http://example.org/latest|2.0.0',
    ]));
  });
});

async function addPackage(
  root: string,
  packageName: string,
  profileUrl: string,
): Promise<void> {
  const packageDir = path.join(root, packageName, 'package');
  const version = packageName.split('#')[1];
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'StructureDefinition-test.json'),
    JSON.stringify({
      resourceType: 'StructureDefinition',
      url: profileUrl,
      version,
    }),
  );
}
