import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scanner = vi.hoisted(() => vi.fn().mockResolvedValue(0));
vi.mock('./sd-loader-package-scanner.js', () => ({ scanCacheDirectory: scanner }));
import { scanProfileSources } from './sd-loader-package-source-scanning.js';
import { initializeStructureDefinitionCache } from './sd-loader-cache-runtime.js';

describe('runtime package source reader ownership', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('passes only package pins to the scanner and never grants a writer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'records-sd-runtime-reader-'));
    roots.push(root);
    const availableProfiles = new Set<string>();
    const packageVersionPins = { 'example.fhir': '1.0.0' };

    expect(await scanProfileSources({ packageSources: [root], availableProfiles, packageVersionPins })).toBe(1);
    expect(scanner).toHaveBeenCalledExactlyOnceWith(root, availableProfiles, { packageVersionPins });
  });

  it.each([true, false])('only enumerates package inventories when preloading is %s', async preloadPackageInventory => {
    const root = await mkdtemp(path.join(tmpdir(), 'records-sd-lazy-reader-'));
    roots.push(root);
    const availableProfiles = new Set<string>();
    await initializeStructureDefinitionCache({ packageSources: [root], availableProfiles,
      packageVersionPins: {}, prewarmProfileSource: false, preloadPackageInventory,
      cache: new Map(), maxCacheEntries: 192, externalProfileCacheKeys: new Set() });
    expect(scanner).toHaveBeenCalledTimes(preloadPackageInventory ? 1 : 0);
    expect(availableProfiles.size).toBe(0);
  });
});
