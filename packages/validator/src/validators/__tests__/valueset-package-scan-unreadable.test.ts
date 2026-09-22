import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findResourceByCanonicalScan } from '../valueset-package-search';
import { logger } from '../../logger';
import { resetPackageStoreDiagnostics } from '../../package/package-store-diagnostics';

describe('scanning a package that cannot be listed', () => {
  const roots: string[] = [];

  beforeEach(() => resetPackageStoreDiagnostics());

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  // Skipping silently makes a package that cannot be read look like one that
  // holds nothing, and the canonical then resolves from a lower-ranked store
  // or not at all. `package` is a plain file here, so listing it fails with
  // ENOTDIR while the store above it lists fine — no chmod, which a
  // root-owned CI container would not feel.
  it('names the package instead of treating it as empty', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'valueset-scan-unreadable-'));
    roots.push(root);
    await mkdir(path.join(root, 'broken#1.0.0'), { recursive: true });
    await writeFile(path.join(root, 'broken#1.0.0', 'package'), 'not a directory');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await expect(findResourceByCanonicalScan(
      [root], 'http://example.test/ValueSet/anything', 'ValueSet',
    )).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treated as empty'),
      expect.objectContaining({ failureCode: 'ENOTDIR' }),
    );
  });

  it('stays silent for a package directory that simply holds nothing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'valueset-scan-empty-'));
    roots.push(root);
    await mkdir(path.join(root, 'empty#1.0.0', 'package'), { recursive: true });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await expect(findResourceByCanonicalScan(
      [root], 'http://example.test/ValueSet/anything', 'ValueSet',
    )).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
  });
});
