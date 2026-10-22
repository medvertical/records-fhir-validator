import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadFromPersistentIndex,
  PERSISTENT_INDEX_VERSION,
  saveToPersistentIndex,
  createProfileIndexWriter,
} from './sd-loader-persistent-index';

describe('sd-loader persistent index safety', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('writes a deterministic index atomically without leaving temporary files', async () => {
    const root = await createRoot();
    const profiles = new Set(['http://example.org/Profile/z', 'http://example.org/Profile/a']);

    await saveToPersistentIndex(root, profiles, []);

    await expect(loadFromPersistentIndex(root)).resolves.toEqual(new Set([
      'http://example.org/Profile/a',
      'http://example.org/Profile/z',
    ]));
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('binds an immutable writer to its resolved source without filesystem I/O', async () => {
    const root = await createRoot();
    const read = vi.spyOn(fs, 'readFile');
    const list = vi.spyOn(fs, 'readdir');
    const writer = createProfileIndexWriter(path.join(root, 'nested', '..'));

    expect(writer.sourcePath).toBe(path.resolve(root));
    expect(Object.isFrozen(writer)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    await writer.save(new Set(['http://example.org/Profile/a']), [], {});
    await expect(loadFromPersistentIndex(root)).resolves.toEqual(new Set(['http://example.org/Profile/a']));
  });

  it('preserves the original writer error when temporary-file cleanup also fails', async () => {
    const root = await createRoot();
    const failure = new Error('source is read-only');
    vi.spyOn(fs, 'writeFile').mockRejectedValue(failure);
    vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('cleanup denied'));

    await expect(createProfileIndexWriter(root).save(new Set(), [], {})).rejects.toBe(failure);
  });

  it('cleans up its temporary file after rename failure without replacing an existing index', async () => {
    const root = await createRoot();
    await saveToPersistentIndex(root, new Set(['http://example.org/Profile/old']), []);
    const failure = new Error('rename denied');
    vi.spyOn(fs, 'rename').mockRejectedValue(failure);

    await expect(createProfileIndexWriter(root).save(
      new Set(['http://example.org/Profile/new']), [], {},
    )).rejects.toBe(failure);

    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await expect(loadFromPersistentIndex(root)).resolves.toEqual(new Set(['http://example.org/Profile/old']));
  });

  it.each([
    { version: PERSISTENT_INDEX_VERSION, generatedAt: 1, packages: [], sourcePackages: [], profileUrls: [42] },
    { version: PERSISTENT_INDEX_VERSION, generatedAt: -1, packages: [], sourcePackages: [], profileUrls: [] },
    { version: PERSISTENT_INDEX_VERSION, generatedAt: 1, packages: [], sourcePackages: 'invalid', profileUrls: [] },
    { version: PERSISTENT_INDEX_VERSION, generatedAt: 1, packages: [{ name: 'x', profileCount: -1, manifestHash: null }], sourcePackages: [], profileUrls: [] },
  ])('rejects a persistent index with an invalid schema', async invalidIndex => {
    const root = await createRoot();
    await writeFile(
      path.join(root, 'sdloader-profile-index.json'),
      JSON.stringify(invalidIndex),
    );

    await expect(loadFromPersistentIndex(root)).resolves.toBeNull();
  });

  it('loads only the validated index fields and ignores unknown persisted properties', async () => {
    const root = await createRoot();
    await writeFile(
      path.join(root, 'sdloader-profile-index.json'),
      JSON.stringify({
        version: PERSISTENT_INDEX_VERSION,
        generatedAt: Date.now(),
        options: { deduplicatePackages: true },
        packages: [],
        sourcePackages: [],
        profileUrls: ['http://example.org/Profile/a'],
        unexpected: { trusted: false },
      }),
    );

    await expect(loadFromPersistentIndex(root)).resolves.toEqual(
      new Set(['http://example.org/Profile/a']),
    );
  });

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'records-sd-index-'));
    tempDirs.push(root);
    return root;
  }
});
