import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findResourceByCanonicalScan,
  findResourceInPackages,
  ValueSetPackageIndexCache,
} from './valueset-package-search';

describe('ValueSet package index cache', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  it('reloads a package index after the index file changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-index-'));
    temporaryRoots.push(root);
    const packagePath = path.join(root, 'example.package#1.0.0', 'package');
    await fs.mkdir(packagePath, { recursive: true });

    const canonical = 'https://example.test/ValueSet/revisioned';
    await writePackageRevision(packagePath, canonical, 'first', '1.0.0');
    const indexCache = new ValueSetPackageIndexCache();

    await expect(findResourceByCanonicalScan<{ url: string; version: string }>(
      [root],
      canonical,
      'ValueSet',
      undefined,
      undefined,
      indexCache,
    )).resolves.toMatchObject({ version: '1.0.0' });

    await fs.rm(path.join(packagePath, 'ValueSet-first.json'));
    await writePackageRevision(packagePath, canonical, 'second-longer', '2.0.0');

    await expect(findResourceByCanonicalScan<{ url: string; version: string }>(
      [root],
      canonical,
      'ValueSet',
      undefined,
      undefined,
      indexCache,
    )).resolves.toMatchObject({ version: '2.0.0' });
  });

  it('resolves packages reached through a symlinked package directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-symlink-root-'));
    temporaryRoots.push(root);
    const realStore = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-symlink-real-'));
    temporaryRoots.push(realStore);

    const realPackageDir = path.join(realStore, 'example.linked#1.0.0');
    const packagePath = path.join(realPackageDir, 'package');
    await fs.mkdir(packagePath, { recursive: true });

    const canonical = 'https://example.test/ValueSet/linked';
    await writePackageRevision(packagePath, canonical, 'linked', '1.0.0');
    await fs.symlink(realPackageDir, path.join(root, 'example.linked#1.0.0'), 'dir');

    await expect(findResourceInPackages<{ url: string; version: string }>(
      [root],
      canonical,
      ['ValueSet-linked.json'],
    )).resolves.toMatchObject({ version: '1.0.0' });

    await expect(findResourceByCanonicalScan<{ url: string; version: string }>(
      [root],
      canonical,
      'ValueSet',
      undefined,
      undefined,
      new ValueSetPackageIndexCache(),
    )).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('ignores symlinked package entries whose target is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-symlink-broken-'));
    temporaryRoots.push(root);
    await fs.symlink(path.join(root, 'does-not-exist'), path.join(root, 'example.broken#1.0.0'), 'dir');

    await expect(findResourceInPackages(
      [root],
      'https://example.test/ValueSet/absent',
      ['ValueSet-absent.json'],
    )).resolves.toBeNull();
  });
});

describe('requested-version fallback', () => {
  const temporaryRoots: string[] = [];
  const canonical = 'http://hl7.org/fhir/ValueSet/encounter-status';

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  async function makeRoot(
    copies: Array<{ packageName: string; version: string }>,
    withIndex = false,
  ): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-version-'));
    temporaryRoots.push(root);
    for (const copy of copies) {
      const packagePath = path.join(root, copy.packageName, 'package');
      await fs.mkdir(packagePath, { recursive: true });
      const filename = 'ValueSet-encounter-status.json';
      await fs.writeFile(
        path.join(packagePath, filename),
        JSON.stringify({ resourceType: 'ValueSet', url: canonical, version: copy.version }),
      );
      if (withIndex) {
        await fs.writeFile(
          path.join(packagePath, '.index.json'),
          JSON.stringify({
            files: [{ filename, resourceType: 'ValueSet', url: canonical, version: copy.version }],
          }),
        );
      }
    }
    return root;
  }

  it('findResourceInPackages returns null when only a cross-major copy exists', async () => {
    const root = await makeRoot([{ packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' }]);

    await expect(findResourceInPackages(
      [root],
      canonical,
      ['ValueSet-encounter-status.json'],
      '5',
      '5.0.0',
    )).resolves.toBeNull();
  });

  it.each([false, true])('resolves wildcard versions with package index %s', async withIndex => {
    const root = await makeRoot([{ packageName: 'hl7.fhir.r5.core#5.0.0', version: '5.0.0' }], withIndex);
    await expect(findResourceInPackages([root], canonical, ['ValueSet-encounter-status.json'], '5', '*'))
      .resolves.toMatchObject({ version: '5.0.0' });
    await expect(findResourceByCanonicalScan([root], canonical, 'ValueSet', '5', '*'))
      .resolves.toMatchObject({ version: '5.0.0' });
  });

  it('findResourceByCanonicalScan returns null when only a cross-major copy exists', async () => {
    const root = await makeRoot([{ packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' }]);

    await expect(findResourceByCanonicalScan(
      [root],
      canonical,
      'ValueSet',
      '5',
      '5.0.0',
    )).resolves.toBeNull();
  });

  it('findResourceByCanonicalScan via package index returns null when only a cross-major copy exists', async () => {
    const root = await makeRoot([{ packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' }], true);

    await expect(findResourceByCanonicalScan(
      [root],
      canonical,
      'ValueSet',
      '5',
      '5.0.0',
    )).resolves.toBeNull();
  });

  it('still resolves the exact version when a same-canonical cross-major copy is also present', async () => {
    const root = await makeRoot([
      { packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' },
      { packageName: 'hl7.fhir.r5.core#5.0.0', version: '5.0.0' },
    ]);

    await expect(findResourceInPackages<{ version?: string }>(
      [root],
      canonical,
      ['ValueSet-encounter-status.json'],
      '5',
      '5.0.0',
    )).resolves.toMatchObject({ version: '5.0.0' });
    await expect(findResourceByCanonicalScan<{ version?: string }>(
      [root],
      canonical,
      'ValueSet',
      '5',
      '5.0.0',
    )).resolves.toMatchObject({ version: '5.0.0' });
  });

  it('keeps same-major minor-version mismatches as acceptable fallbacks', async () => {
    const root = await makeRoot([{ packageName: 'hl7.fhir.r4b.core#4.3.0', version: '4.3.0' }]);

    await expect(findResourceInPackages<{ version?: string }>(
      [root],
      canonical,
      ['ValueSet-encounter-status.json'],
      '4',
      '4.0.1',
    )).resolves.toMatchObject({ version: '4.3.0' });
    await expect(findResourceByCanonicalScan<{ version?: string }>(
      [root],
      canonical,
      'ValueSet',
      '4',
      '4.0.1',
    )).resolves.toMatchObject({ version: '4.3.0' });
  });
});

describe('pinned versions and deterministic store order', () => {
  const temporaryRoots: string[] = [];
  const canonical = 'https://example.test/ValueSet/kontaktart';

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  interface StoreCopy {
    packageName: string;
    version: string;
    marker?: string;
    withIndex?: boolean;
  }

  async function makeStore(copies: StoreCopy[]): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-valueset-store-'));
    temporaryRoots.push(root);
    for (const copy of copies) {
      const packagePath = path.join(root, copy.packageName, 'package');
      await fs.mkdir(packagePath, { recursive: true });
      const filename = 'ValueSet-kontaktart.json';
      await fs.writeFile(
        path.join(packagePath, filename),
        JSON.stringify({
          resourceType: 'ValueSet',
          url: canonical,
          version: copy.version,
          ...(copy.marker ? { name: copy.marker } : {}),
        }),
      );
      if (copy.withIndex) {
        await fs.writeFile(
          path.join(packagePath, '.index.json'),
          JSON.stringify({
            files: [{ filename, resourceType: 'ValueSet', url: canonical, version: copy.version }],
          }),
        );
      }
    }
    return root;
  }

  it('resolves a pinned version from any store even when an earlier store has a newer copy', async () => {
    const cacheStore = await makeStore([{ packageName: 'de.basisprofil#1.6.0', version: '1.6.0' }]);
    const bundledStore = await makeStore([{ packageName: 'de.basisprofil#1.5.4', version: '1.5.4' }]);

    for (const stores of [[cacheStore, bundledStore], [bundledStore, cacheStore]]) {
      await expect(findResourceInPackages<{ version?: string }>(
        stores,
        canonical,
        ['ValueSet-kontaktart.json'],
        undefined,
        '1.5.4',
      )).resolves.toMatchObject({ version: '1.5.4' });
      await expect(findResourceByCanonicalScan<{ version?: string }>(
        stores,
        canonical,
        'ValueSet',
        undefined,
        '1.5.4',
      )).resolves.toMatchObject({ version: '1.5.4' });
    }
  });

  it('resolves the same resource version from the earlier store, even against a newer package directory', async () => {
    const bundledStore = await makeStore([
      { packageName: 'example.pkg#1.0.0', version: '1.0.0', marker: 'FromBundled', withIndex: true },
    ]);
    const cacheStore = await makeStore([
      { packageName: 'example.pkg#2.0.0', version: '1.0.0', marker: 'FromCache', withIndex: true },
    ]);

    await expect(findResourceInPackages<{ name?: string }>(
      [bundledStore, cacheStore],
      canonical,
      ['ValueSet-kontaktart.json'],
    )).resolves.toMatchObject({ name: 'FromBundled' });
    await expect(findResourceByCanonicalScan<{ name?: string }>(
      [bundledStore, cacheStore],
      canonical,
      'ValueSet',
    )).resolves.toMatchObject({ name: 'FromBundled' });
  });

  it('still prefers a newer same-major resource from a later store when nothing is pinned', async () => {
    const bundledStore = await makeStore([{ packageName: 'de.basisprofil#1.5.4', version: '1.5.4' }]);
    const cacheStore = await makeStore([{ packageName: 'de.basisprofil#1.6.0', version: '1.6.0' }]);

    await expect(findResourceInPackages<{ version?: string }>(
      [bundledStore, cacheStore],
      canonical,
      ['ValueSet-kontaktart.json'],
    )).resolves.toMatchObject({ version: '1.6.0' });
  });

  it('breaks equal-version ties inside one store by package name, not readdir order', async () => {
    const store = await makeStore([
      { packageName: 'zz.example#1.0.0', version: '1.0.0', marker: 'FromZz' },
      { packageName: 'aa.example#1.0.0', version: '1.0.0', marker: 'FromAa' },
    ]);

    await expect(findResourceInPackages<{ name?: string }>(
      [store],
      canonical,
      ['ValueSet-kontaktart.json'],
    )).resolves.toMatchObject({ name: 'FromAa' });
  });

  it('keeps the cross-major guard for pinned versions despite a newer cache copy', async () => {
    const cacheStore = await makeStore([{ packageName: 'de.basisprofil#2.0.0', version: '2.0.0' }]);

    await expect(findResourceInPackages(
      [cacheStore],
      canonical,
      ['ValueSet-kontaktart.json'],
      undefined,
      '1.5.4',
    )).resolves.toBeNull();
  });
});

describe('terminology.hl7.org authority preference', () => {
  const temporaryRoots: string[] = [];
  const canonical = 'http://terminology.hl7.org/CodeSystem/adverse-event-seriousness';

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  async function makeRoot(
    copies: Array<{ packageName: string; version: string; code: string }>,
  ): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-tho-authority-'));
    temporaryRoots.push(root);
    for (const copy of copies) {
      const packagePath = path.join(root, copy.packageName, 'package');
      await fs.mkdir(packagePath, { recursive: true });
      await fs.writeFile(
        path.join(packagePath, 'CodeSystem-adverse-event-seriousness.json'),
        JSON.stringify({
          resourceType: 'CodeSystem',
          url: canonical,
          version: copy.version,
          concept: [{ code: copy.code }],
        }),
      );
    }
    return root;
  }

  it('prefers the hl7.terminology copy over the stale core snapshot', async () => {
    // R4 core ships a frozen pre-THO copy (version 4.0.1, capitalised codes);
    // THO is the maintained home of the canonical and must win even though
    // the core package matches the preferred FHIR major and carries the
    // numerically higher resource version.
    const root = await makeRoot([
      { packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1', code: 'Non-serious' },
      { packageName: 'hl7.terminology.r4#6.5.0', version: '1.0.1', code: 'non-serious' },
    ]);

    await expect(findResourceInPackages(
      [root],
      canonical,
      ['CodeSystem-adverse-event-seriousness.json'],
      '4',
    )).resolves.toMatchObject({ version: '1.0.1' });
  });

  it('keeps normal ranking for canonicals outside terminology.hl7.org', async () => {
    const coreCanonical = 'http://hl7.org/fhir/CodeSystem/task-status';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-tho-authority-'));
    temporaryRoots.push(root);
    for (const copy of [
      { packageName: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' },
      { packageName: 'hl7.terminology.r4#6.5.0', version: '1.0.1' },
    ]) {
      const packagePath = path.join(root, copy.packageName, 'package');
      await fs.mkdir(packagePath, { recursive: true });
      await fs.writeFile(
        path.join(packagePath, 'CodeSystem-task-status.json'),
        JSON.stringify({ resourceType: 'CodeSystem', url: coreCanonical, version: copy.version }),
      );
    }

    await expect(findResourceInPackages(
      [root],
      coreCanonical,
      ['CodeSystem-task-status.json'],
      '4',
    )).resolves.toMatchObject({ version: '4.0.1' });
  });
});

async function writePackageRevision(
  packagePath: string,
  canonical: string,
  suffix: string,
  version: string,
): Promise<void> {
  const filename = `ValueSet-${suffix}.json`;
  await fs.writeFile(
    path.join(packagePath, filename),
    JSON.stringify({ resourceType: 'ValueSet', url: canonical, version }),
  );
  await fs.writeFile(
    path.join(packagePath, '.index.json'),
    JSON.stringify({ files: [{ filename, resourceType: 'ValueSet', url: canonical, version }] }),
  );
}
