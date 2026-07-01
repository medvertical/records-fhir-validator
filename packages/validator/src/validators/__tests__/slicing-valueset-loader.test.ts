import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedSlicingValueSetLoader,
  withResolvedFhirPackageCachePath,
} from '../slicing-valueset-loader';

const originalCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;

describe('slicing ValueSet loader boundary', () => {
  afterEach(() => {
    if (originalCachePath === undefined) {
      delete process.env.FHIR_PACKAGE_CACHE_PATH;
    } else {
      process.env.FHIR_PACKAGE_CACHE_PATH = originalCachePath;
    }
  });

  it('uses the real home directory when dotenv left a literal $HOME path', () => {
    process.env.FHIR_PACKAGE_CACHE_PATH = '$HOME/.fhir/packages';

    const loader = createIsolatedSlicingValueSetLoader();

    expect(process.env.FHIR_PACKAGE_CACHE_PATH).toBe('$HOME/.fhir/packages');
    expect(loader.getPackageDirectories()[0]).toBe(join(homedir(), '.fhir', 'packages'));
  });

  it('preserves explicit non-placeholder package cache paths', () => {
    const explicitPath = resolve('/tmp/records-fhir-cache');
    process.env.FHIR_PACKAGE_CACHE_PATH = explicitPath;

    const loader = createIsolatedSlicingValueSetLoader();

    expect(process.env.FHIR_PACKAGE_CACHE_PATH).toBe(explicitPath);
    expect(loader.getPackageDirectories()[0]).toBe(explicitPath);
  });

  it('searches the current bundled profile package directory for slicing ValueSets', () => {
    const loader = createIsolatedSlicingValueSetLoader();

    expect(loader.getPackageDirectories()).toContain(
      join(process.cwd(), 'packages', 'bundled-profiles', 'storage', 'profiles', 'bundled'),
    );
  });

  it('restores literal $HOME paths when loader creation throws', () => {
    process.env.FHIR_PACKAGE_CACHE_PATH = '$HOME/.fhir/packages';

    expect(() => withResolvedFhirPackageCachePath(() => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(process.env.FHIR_PACKAGE_CACHE_PATH).toBe('$HOME/.fhir/packages');
  });
});
