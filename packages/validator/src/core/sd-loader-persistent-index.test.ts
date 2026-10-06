import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadFromPersistentIndex,
  PERSISTENT_INDEX_VERSION,
  saveToPersistentIndex,
} from './sd-loader-persistent-index';

describe('sd-loader persistent index safety', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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
