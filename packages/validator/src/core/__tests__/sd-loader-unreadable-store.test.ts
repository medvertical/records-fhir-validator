import { promises as fsPromises } from 'fs';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFromLocalCache } from '../sd-loader-filesystem';
import { selectPackageVersions } from '../sd-loader-package-selection';
import { PackageProfileIndexCache } from '../sd-loader-package-profile-index';
import { logger } from '../../logger';
import { resetPackageStoreDiagnostics } from '../../package/package-store-diagnostics';

const PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/Patient';

describe('sd-loader read failures', () => {
  const tempDirs: string[] = [];

  beforeEach(() => resetPackageStoreDiagnostics());

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  // A store that cannot be listed used to answer exactly like an empty one, so
  // every profile it holds resolved as "not found" with nothing said anywhere.
  // The permission failure is injected rather than made with chmod, which a
  // root-owned CI container would not feel.
  it('names a package store it could not list', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-unreadable-'));
    tempDirs.push(source);
    vi.spyOn(fsPromises, 'readdir').mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await expect(loadFromLocalCache(PROFILE_URL, [source], 'R4')).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treated as empty'),
      expect.objectContaining({ failureCode: 'EACCES' }),
    );
  });

  // A package directory that cannot be listed answers "holds no JSON", which
  // drops the package from the scan entirely — an installed IG simply stops
  // resolving, with nothing said anywhere.
  it('names a package directory it could not list', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-package-unreadable-'));
    tempDirs.push(source);
    vi.spyOn(fsPromises, 'readdir').mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await selectPackageVersions({
      sourcePath: source,
      packageVersions: new Map([['hl7.fhir.r4.core', [
        { name: 'hl7.fhir.r4.core#4.0.1', version: '4.0.1' },
        { name: 'hl7.fhir.r4.core#4.0.0', version: '4.0.0' },
      ]]]),
      packageVersionPins: {},
      deduplicateEnabled: true,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treated as empty'),
      expect.objectContaining({ failureCode: 'EACCES' }),
    );
  });

  it('stays silent for a store that is simply not installed', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await expect(
      loadFromLocalCache(PROFILE_URL, [path.join(tmpdir(), 'sd-loader-absent-store')], 'R4'),
    ).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
  });

  // The listing found the file, so a parse failure means an installed profile
  // is being dropped from the index rather than one that was never there.
  it('names a profile file it could not parse', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-broken-'));
    tempDirs.push(source);
    const packageDir = path.join(source, 'hl7.fhir.r4.core#4.0.1', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'StructureDefinition-Patient.json'), '{ not json');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    await expect(
      loadFromLocalCache(PROFILE_URL, [source], 'R4', {}, new PackageProfileIndexCache()),
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('being skipped'),
      expect.objectContaining({ failureCode: 'unknown' }),
    );
  });
});
