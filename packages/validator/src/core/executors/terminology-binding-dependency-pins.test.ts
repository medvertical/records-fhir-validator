import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearProfilePackageProvenance,
  recordProfilePackageProvenance,
} from '../../package/canonical-pin-provenance';
import { findResourceInPackages } from '../../validators/valueset-package-search';
import { pinBindingToDependencyPins } from './terminology-binding-dependency-pins';
import { resolveValueSetPackageDirectories } from '../../validators/valueset-package-resource-access';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';

vi.mock('../../validators/valueset-package-resource-access', async importOriginal => ({
  ...await importOriginal<typeof import('../../validators/valueset-package-resource-access')>(),
  resolveValueSetPackageDirectories: vi.fn(() => []),
}));

const PROFILE_URL = 'http://example.org/fhir/igx/StructureDefinition/pinned-profile';
const VALUE_SET = 'http://example.org/fhir/dep/ValueSet/dep-codes';

describe('pinBindingToDependencyPins', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearProfilePackageProvenance();
    clearCanonicalPinCaches();
    vi.mocked(resolveValueSetPackageDirectories).mockReturnValue([]);
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createStore(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'binding-pins-'));
    tempDirs.push(dir);
    vi.mocked(resolveValueSetPackageDirectories).mockReturnValue([dir]);
    return dir;
  }

  it('leaves bindings of profiles without package provenance untouched', async () => {
    const binding = { strength: 'required' as const, valueSet: VALUE_SET };

    await expect(pinBindingToDependencyPins(binding, { url: PROFILE_URL, version: '1.0.0' }, 'R4'))
      .resolves.toEqual(binding);
  });

  it('pins a cross-IG binding to the version the profile source package declares', async () => {
    const store = await createStore();
    await writeSourcePackage(store, { 'example.dep': '1.0.0' });
    await writeValueSetPackage(store, '1.0.0', '1.0.0');
    await writeValueSetPackage(store, '2.0.0', '2.0.0');
    recordProfilePackageProvenance(PROFILE_URL, '1.0.0', 'example.igx#1.0.0');

    await expect(pinBindingToDependencyPins(
      { strength: 'required', valueSet: VALUE_SET },
      { url: PROFILE_URL, version: '1.0.0' }, 'R4',
    )).resolves.toMatchObject({ valueSet: `${VALUE_SET}|1.0.0` });
  });

  it('pins a same-IG binding to its ValueSet version rather than the profile or package version', async () => {
    const store = await createStore();
    await writeSourcePackage(store, {});
    const valueSet = 'http://example.org/fhir/igx/ValueSet/own-codes';
    const packageDir = path.join(store, 'example.igx#1.0.0', 'package');
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      'index-version': 2,
      files: [{ filename: 'ValueSet-own-codes.json', resourceType: 'ValueSet', url: valueSet, version: '3.2.0' }],
    }));
    recordProfilePackageProvenance(PROFILE_URL, '2.1.0', 'example.igx#1.0.0');

    await expect(pinBindingToDependencyPins(
      { strength: 'required', valueSet },
      { url: PROFILE_URL, version: '2.1.0' }, 'R4',
    )).resolves.toMatchObject({ valueSet: `${valueSet}|3.2.0` });
  });

  it.each([
    'http://example.org/fhir/igx/ValueSet/own-codes',
    `${VALUE_SET}|9.0.0`,
    'http://hl7.org/fhir/ValueSet/observation-status',
  ])('does not invent a version without owning-package evidence for %s', async valueSet => {
    const binding = { strength: 'required' as const, valueSet };
    await expect(pinBindingToDependencyPins(binding, { url: PROFILE_URL, version: '1.0.0' }, 'R4'))
      .resolves.toBe(binding);
  });

  it('lets the cross-major guard reject a pinned version with no same-major candidate', async () => {
    const store = await createStore();
    // Only a 2.x resource is installed while the pin requests 1.0.0 — the
    // ValueSet search must refuse the cross-major stand-in rather than
    // validating codes against the wrong major.
    await writeValueSetPackage(store, '2.0.0', '2.0.0');

    await expect(findResourceInPackages(
      [store],
      VALUE_SET,
      ['ValueSet-dep-codes.json'],
      undefined,
      '1.0.0',
    )).resolves.toBeNull();
  });

  it('honors a soft pin exactly when the pinned resource version is installed', async () => {
    const store = await createStore();
    await writeValueSetPackage(store, '1.0.0', '1.0.0');
    await writeValueSetPackage(store, '2.0.0', '2.0.0');

    const resolved = await findResourceInPackages<{ url?: string; version?: string }>(
      [store],
      VALUE_SET,
      ['ValueSet-dep-codes.json'],
      undefined,
      '1.0.0',
    );

    expect(resolved?.version).toBe('1.0.0');
  });

  async function writeSourcePackage(
    store: string,
    dependencies: Record<string, string>,
  ): Promise<void> {
    const packageDir = path.join(store, 'example.igx#1.0.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'example.igx',
      version: '1.0.0',
      canonical: 'http://example.org/fhir/igx',
      fhirVersions: ['4.0.1'],
      dependencies,
    }));
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      'index-version': 2,
      files: [{
        filename: 'StructureDefinition-pinned-profile.json',
        resourceType: 'StructureDefinition',
        url: PROFILE_URL,
        version: '1.0.0',
      }],
    }));
  }

  async function writeValueSetPackage(
    store: string,
    packageVersion: string,
    resourceVersion: string,
  ): Promise<void> {
    const packageDir = path.join(store, `example.dep#${packageVersion}`, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'example.dep',
      version: packageVersion,
      canonical: 'http://example.org/fhir/dep',
      fhirVersions: ['4.0.1'],
    }));
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      'index-version': 2,
      files: [{
        filename: 'ValueSet-dep-codes.json',
        resourceType: 'ValueSet',
        url: VALUE_SET,
        version: resourceVersion,
      }],
    }));
    await writeFile(path.join(packageDir, 'ValueSet-dep-codes.json'), JSON.stringify({
      resourceType: 'ValueSet',
      url: VALUE_SET,
      version: resourceVersion,
      status: 'active',
    }));
  }
});
