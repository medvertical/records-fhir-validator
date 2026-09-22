import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalIndexFingerprint,
  clearCanonicalIndexFile,
  readCanonicalIndex,
  writeCanonicalIndex,
} from '../valueset-canonical-index-store';

const PAYLOAD = {
  byCanonical: new Map([['ValueSet|http://example.test/vs', [
    { packageName: 'pkg#1.0.0', filename: 'ValueSet-vs.json', version: '1.0.0' },
    { packageName: 'other#1.0.0', filename: 'vs.json' },
  ]]]),
  opaquePackages: new Set<string>(['bare#1.0.0']),
};

describe('persisted canonical index', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async dir => {
      await chmod(dir, 0o755).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }));
  });

  async function store(packageName = 'pkg#1.0.0', version = '1.0.0'): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'canonical-store-'));
    roots.push(root);
    const packageDir = path.join(root, packageName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version }));
    return root;
  }

  it('reads back what it wrote', async () => {
    const root = await store();
    const fingerprint = await canonicalIndexFingerprint([root]);
    await writeCanonicalIndex([root], fingerprint, PAYLOAD);

    const back = await readCanonicalIndex([root], fingerprint);
    expect(back!.byCanonical.get('ValueSet|http://example.test/vs')).toEqual([
      { packageName: 'other#1.0.0', filename: 'vs.json' },
      { packageName: 'pkg#1.0.0', filename: 'ValueSet-vs.json', version: '1.0.0' },
    ]);
    expect([...back!.opaquePackages]).toEqual(['bare#1.0.0']);
  });

  // A package name is written once and referenced by position: spelled out per
  // declaration it made the file three times larger than the index it carries.
  it('stores package names once', async () => {
    const root = await store();
    const fingerprint = await canonicalIndexFingerprint([root]);
    await writeCanonicalIndex([root], fingerprint, PAYLOAD);

    const written = (await readdir(root)).find(name => name.startsWith('.terminology-canonical-index'))!;
    const persisted = JSON.parse(await readFile(path.join(root, written), 'utf8'));
    expect(persisted.packages).toEqual(['other#1.0.0', 'pkg#1.0.0']);
    expect(persisted.canonicals['ValueSet|http://example.test/vs']).toEqual([
      [0, 'vs.json'],
      [1, 'ValueSet-vs.json', '1.0.0'],
    ]);
  });

  // Identity is the package manifest, not the directory mtime: a container
  // image COPY rewrites mtimes although the package content is immutable.
  it('ignores a file that describes different packages', async () => {
    const root = await store();
    await writeCanonicalIndex([root], await canonicalIndexFingerprint([root]), PAYLOAD);

    await writeFile(path.join(root, 'pkg#1.0.0', 'package', 'package.json'),
      JSON.stringify({ name: 'pkg#1.0.0', version: '2.0.0' }));

    expect(await readCanonicalIndex([root], await canonicalIndexFingerprint([root]))).toBeNull();
  });

  it('ignores a file written for a different set of stores', async () => {
    const first = await store();
    const second = await store('other#1.0.0');
    await writeCanonicalIndex([first], await canonicalIndexFingerprint([first]), PAYLOAD);

    expect(await readCanonicalIndex([first, second], await canonicalIndexFingerprint([first, second]))).toBeNull();
  });

  // The first store is regularly absent or read-only; any of them will do.
  it('falls through to a store it can write', async () => {
    const absent = path.join(tmpdir(), 'canonical-store-absent');
    const writable = await store();
    const roots = [absent, writable];
    const fingerprint = await canonicalIndexFingerprint(roots);

    await writeCanonicalIndex(roots, fingerprint, PAYLOAD);

    expect((await readdir(writable)).some(name => name.startsWith('.terminology-canonical-index'))).toBe(true);
    expect(await readCanonicalIndex(roots, fingerprint)).not.toBeNull();
  });

  it('removes the file it wrote', async () => {
    const root = await store();
    const fingerprint = await canonicalIndexFingerprint([root]);
    await writeCanonicalIndex([root], fingerprint, PAYLOAD);

    await clearCanonicalIndexFile([root]);

    expect(await readCanonicalIndex([root], fingerprint)).toBeNull();
  });

  // One file per store, not one per store set: a run of the suite left 56
  // digest-named files and 126 MB in the bundled store, none read again.
  it('replaces the digest-named files an earlier build left behind', async () => {
    const root = await store();
    await writeFile(path.join(root, '.terminology-canonical-index-0123456789abcdef.json'), '{}');
    await writeFile(path.join(root, '.terminology-canonical-index-fedcba9876543210.json'), '{}');

    await writeCanonicalIndex([root], await canonicalIndexFingerprint([root]), PAYLOAD);

    expect((await readdir(root)).filter(name => name.startsWith('.terminology-canonical-index')))
      .toEqual(['.terminology-canonical-index.json']);
  });

  // The temporary store is gone next start, so an index naming it can never be
  // read back — writing it into the lasting store would only replace the file
  // that store can still use.
  it('keeps an index that names a temporary store out of a lasting one', async () => {
    // Anywhere outside the OS temp directory; node_modules is ignored by git.
    const lasting = await mkdtemp(path.join(process.cwd(), 'node_modules', '.canonical-store-lasting-'));
    roots.push(lasting);
    const temporary = await store();
    const both = [lasting, temporary];

    await writeCanonicalIndex(both, await canonicalIndexFingerprint(both), PAYLOAD);

    expect((await readdir(lasting)).some(name => name.startsWith('.terminology-canonical-index'))).toBe(false);
    expect((await readdir(temporary)).some(name => name.startsWith('.terminology-canonical-index'))).toBe(true);
  });

  it('says nothing is stored when no store is given', async () => {
    expect(await readCanonicalIndex([], [])).toBeNull();
    await expect(writeCanonicalIndex([], [], PAYLOAD)).resolves.toBeUndefined();
  });
});
