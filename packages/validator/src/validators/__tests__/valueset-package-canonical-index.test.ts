import { mkdtemp, mkdir, writeFile, readdir, rm, stat, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageCanonicalIndex } from '../valueset-package-canonical-index';

const ACCOUNT_STATUS = 'http://hl7.org/fhir/ValueSet/account-status';

describe('package canonical index', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function store(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'canonical-index-'));
    roots.push(root);
    return root;
  }

  async function indexedPackage(root: string, name: string, files: unknown[]): Promise<string> {
    const packageDir = path.join(root, name, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({ files }));
    return packageDir;
  }

  it('names the package that declares a canonical and nothing else', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'ValueSet-account-status.json', resourceType: 'ValueSet', url: ACCOUNT_STATUS },
    ]);
    await indexedPackage(root, 'bystander#1.0.0', [
      { filename: 'ValueSet-other.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/other' },
    ]);

    const index = new PackageCanonicalIndex();
    expect([...(await index.packagesFor([root], 'ValueSet', ACCOUNT_STATUS))!]).toEqual(['holder#1.0.0']);
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/absent'))!]).toEqual([]);
  });

  // Callers ask for `url|version`; the index keys on the bare canonical, and
  // missing that made every versioned lookup fall back to a full scan.
  it('answers a versioned canonical from the bare key', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'ValueSet-account-status.json', resourceType: 'ValueSet', url: ACCOUNT_STATUS },
    ]);

    const index = new PackageCanonicalIndex();
    expect([...(await index.packagesFor([root], 'ValueSet', `${ACCOUNT_STATUS}|4.0.1`))!]).toEqual(['holder#1.0.0']);
  });

  it('separates the resource types sharing one canonical', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'CodeSystem-x.json', resourceType: 'CodeSystem', url: 'http://example.test/x' },
    ]);

    const index = new PackageCanonicalIndex();
    expect([...(await index.packagesFor([root], 'CodeSystem', 'http://example.test/x'))!]).toEqual(['holder#1.0.0']);
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/x'))!]).toEqual([]);
  });

  // A package without `.index.json` held 844 files and most of the cost of a
  // miss, so it is read once here rather than scanned on every lookup.
  it('reads a package that ships no index instead of leaving it opaque', async () => {
    const root = await store();
    await indexedPackage(root, 'indexed#1.0.0', [
      { filename: 'ValueSet-a.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/a' },
    ]);
    const bare = path.join(root, 'bare#1.0.0', 'package');
    await mkdir(bare, { recursive: true });
    await writeFile(path.join(bare, 'ValueSet-b.json'), JSON.stringify({ resourceType: 'ValueSet', url: 'http://example.test/ValueSet/b' }));

    const index = new PackageCanonicalIndex();
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/b'))!]).toEqual(['bare#1.0.0']);
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/absent'))!]).toEqual([]);
  });

  it('leaves a resource type it does not index to the caller', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'StructureDefinition-p.json', resourceType: 'StructureDefinition', url: 'http://example.test/p' },
    ]);

    const index = new PackageCanonicalIndex();
    expect(await index.packagesFor([root], 'StructureDefinition', 'http://example.test/p')).toBeNull();
  });

  it('answers from the store as it is now, not as it was', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'ValueSet-a.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/a' },
    ]);
    const index = new PackageCanonicalIndex();
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/late'))!]).toEqual([]);

    await indexedPackage(root, 'later#1.0.0', [
      { filename: 'ValueSet-late.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/late' },
    ]);
    expect([...(await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/late'))!]).toEqual(['later#1.0.0']);
  });

  // The caller opens the file the index names; without it, well-known filenames
  // were tried in every candidate package and `CodeSystem-v3-ActCode.json` was
  // read eight times, 1.45 MB each, only to compare its url.
  it('names the file and version a package declares', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      {
        filename: 'ValueSet-account-status.json',
        resourceType: 'ValueSet',
        url: ACCOUNT_STATUS,
        version: '4.0.1',
      },
    ]);

    const index = new PackageCanonicalIndex();
    expect(await index.declarationsFor([root], 'ValueSet', `${ACCOUNT_STATUS}|4.0.1`)).toEqual([
      { packageName: 'holder#1.0.0', filename: 'ValueSet-account-status.json', version: '4.0.1' },
    ]);
    expect(await index.declarationsFor([root], 'ValueSet', 'http://example.test/absent')).toEqual([]);
  });

  // The bundled store is reachable through a symlinked second root and the same
  // packages are installed in ~/.fhir/packages, so one declaration was recorded
  // three times — three times the stored file and the same file read three times.
  it('records one declaration per package however many roots reach it', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'ValueSet-a.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/a' },
    ]);
    const mirror = path.join(await store(), 'mirror');
    await symlink(root, mirror);

    const index = new PackageCanonicalIndex();
    expect(await index.declarationsFor([root, mirror], 'ValueSet', 'http://example.test/ValueSet/a')).toEqual([
      { packageName: 'holder#1.0.0', filename: 'ValueSet-a.json' },
    ]);
  });

  // Storing the index inside a store used to change the signature that had just
  // been computed, so every process built the index, wrote it, and then rebuilt.
  it('does not invalidate itself by storing the index', async () => {
    const root = await store();
    await indexedPackage(root, 'holder#1.0.0', [
      { filename: 'ValueSet-a.json', resourceType: 'ValueSet', url: 'http://example.test/ValueSet/a' },
    ]);

    const index = new PackageCanonicalIndex();
    await index.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/a');
    const written = await storedIndexIdentity(root);

    const second = new PackageCanonicalIndex();
    await second.packagesFor([root], 'ValueSet', 'http://example.test/ValueSet/a');
    expect(await storedIndexIdentity(root)).toBe(written);
  });

  async function storedIndexIdentity(root: string): Promise<string> {
    const name = (await readdir(root)).find(entry => entry.startsWith('.terminology-canonical-index'))!;
    return String((await stat(path.join(root, name), { bigint: true })).ino);
  }

  // Two installed packages ship `"files": []` beside their resources. Reading
  // that as "declares nothing" hid them from every lookup; the profile walker
  // has always rejected such an index for the same reason.
  it('reads a package whose index leaves its files unnamed', async () => {
    const root = await store();
    const packageDir = path.join(root, 'empty-index#1.0.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({ 'index-version': 2, files: [] }));
    await writeFile(path.join(packageDir, 'ValueSet-only-here.json'), JSON.stringify({
      resourceType: 'ValueSet', url: 'http://example.test/ValueSet/only-here', version: '1.0.0',
    }));

    const index = new PackageCanonicalIndex();
    expect(await index.declarationsFor([root], 'ValueSet', 'http://example.test/ValueSet/only-here')).toEqual([
      { packageName: 'empty-index#1.0.0', filename: 'ValueSet-only-here.json', version: '1.0.0' },
    ]);
  });

  it('reports no index for a store that is not there', async () => {
    const index = new PackageCanonicalIndex();
    expect(await index.packagesFor([path.join(tmpdir(), 'canonical-index-absent')], 'ValueSet', ACCOUNT_STATUS)).toBeNull();
  });
});
