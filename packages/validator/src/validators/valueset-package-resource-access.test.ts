import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../persistence';
import { ValueSetPackageLoader } from './valueset-package-loader';
import { ValueSetPackageResourceAccess } from './valueset-package-resource-access';

const MONOREPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

describe('ValueSetPackageResourceAccess directory resolution', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    setProfileSource({});
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  it('anchors default monorepo stores at the module location, not process.cwd()', async () => {
    const originalCwd = process.cwd();
    const temporaryCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-cwd-'));
    temporaryRoots.push(temporaryCwd);
    try {
      process.chdir(temporaryCwd);
      const directories = new ValueSetPackageResourceAccess().getPackageDirectories();

      expect(directories).toContain(
        path.join(MONOREPO_ROOT, 'server', 'storage', 'profiles', 'bundled'),
      );
      expect(directories).not.toContain(
        path.join(temporaryCwd, 'server', 'storage', 'profiles', 'bundled'),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('ranks the user package cache after every repo-bundled store', () => {
    const originalCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
    delete process.env.FHIR_PACKAGE_CACHE_PATH;
    try {
      const directories = new ValueSetPackageResourceAccess().getPackageDirectories();
      const cacheIndex = directories.indexOf(path.join(os.homedir(), '.fhir', 'packages'));
      const bundledIndex = directories.indexOf(
        path.join(MONOREPO_ROOT, 'server', 'storage', 'profiles', 'bundled'),
      );

      expect(cacheIndex).toBe(directories.length - 1);
      expect(bundledIndex).toBeGreaterThanOrEqual(0);
      expect(bundledIndex).toBeLessThan(cacheIndex);
    } finally {
      if (originalCachePath !== undefined) {
        process.env.FHIR_PACKAGE_CACHE_PATH = originalCachePath;
      }
    }
  });

  it('findResource upgrades a same-major fallback to an exact pin found only by canonical scan', async () => {
    const store = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-pin-scan-'));
    temporaryRoots.push(store);
    const canonical = 'https://example.test/ValueSet/pinned';

    const fallbackPackage = path.join(store, 'example.newer#1.2.0', 'package');
    await fs.mkdir(fallbackPackage, { recursive: true });
    await fs.writeFile(
      path.join(fallbackPackage, 'ValueSet-pinned.json'),
      JSON.stringify({ resourceType: 'ValueSet', url: canonical, version: '1.2.0' }),
    );

    const pinnedPackage = path.join(store, 'example.pinned#1.0.0', 'package');
    await fs.mkdir(pinnedPackage, { recursive: true });
    await fs.writeFile(
      path.join(pinnedPackage, 'ValueSet-FriendlyName.json'),
      JSON.stringify({ resourceType: 'ValueSet', url: canonical, version: '1.0.0' }),
    );

    const access = new ValueSetPackageResourceAccess([store]);

    await expect(access.findResource<{ version?: string }>(
      canonical,
      ['ValueSet-pinned.json', 'pinned.json'],
      'ValueSet',
      undefined,
      '1.0.0',
    )).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('searches package stores declared via setProfileSource before defaults', async () => {
    const hostStore = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-host-store-'));
    temporaryRoots.push(hostStore);
    const packagePath = path.join(hostStore, 'example.host#1.0.0', 'package');
    await fs.mkdir(packagePath, { recursive: true });

    const canonical = 'https://example.test/CodeSystem/host-store';
    await fs.writeFile(
      path.join(packagePath, 'CodeSystem-host-store.json'),
      JSON.stringify({
        resourceType: 'CodeSystem',
        url: canonical,
        version: '1.0.0',
        content: 'complete',
        concept: [{ code: 'hosted' }],
      }),
    );

    setProfileSource({ packageDirectories: [hostStore] });
    const loader = new ValueSetPackageLoader();

    expect(loader.getPackageDirectories()[0]).toBe(hostStore);
    await expect(loader.loadCodeSystem(canonical)).resolves.toMatchObject({
      url: canonical,
      concept: [{ code: 'hosted' }],
    });
  });

  it('honors a profile source installed after loader construction', async () => {
    const loader = new ValueSetPackageLoader();
    expect(loader.getPackageDirectories()).not.toContain('/tmp/records-late-host-store');

    setProfileSource({ packageDirectories: ['/tmp/records-late-host-store'] });
    expect(loader.getPackageDirectories()[0]).toBe('/tmp/records-late-host-store');
  });

  it('keeps explicitly constructed directories isolated from host stores', () => {
    setProfileSource({ packageDirectories: ['/tmp/records-host-store'] });
    const access = new ValueSetPackageResourceAccess([]);

    expect(access.getPackageDirectories()).toEqual([]);
  });

  it('carries a terminology lookup release to the host without mutating the tenant source context', async () => {
    const canonical = 'http://hl7.org/fhir/encounter-status';
    const findCanonicalResource = vi.fn(async (_url, _type, _version, context) => ({
      resourceType: 'CodeSystem', url: canonical, version: context.fhirVersion === 'R5' ? '5.0.0' : '4.0.1',
    }));
    setProfileSource({ findCanonicalResource });
    const access = new ValueSetPackageResourceAccess([]);
    access.setSourceContext({ organizationId: 7, fhirVersion: 'R4' });
    await expect(access.findResource(canonical, [], 'CodeSystem', '5')).resolves.toMatchObject({ version: '5.0.0' });
    expect(findCanonicalResource).toHaveBeenLastCalledWith(canonical, 'CodeSystem', undefined, { organizationId: 7, fhirVersion: 'R5' });
    await expect(access.findResource(canonical, [], 'CodeSystem', '4')).resolves.toMatchObject({ version: '4.0.1' });
    expect(access.getSourceContext()).toEqual({ organizationId: 7, fhirVersion: 'R4' });
  });
});
