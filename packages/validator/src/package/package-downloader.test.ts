import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import * as tarStream from 'tar-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackageDownloader } from './package-downloader';

describe('PackageDownloader local cache resolution', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function writeInstalledPackage(cacheRoot: string, packageDirName: string, manifestName: string): Promise<void> {
    const packageDir = path.join(cacheRoot, packageDirName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: manifestName,
        version: packageDirName.split('#')[1],
        fhirVersions: ['4.0.1'],
      }),
    );
  }

  it('uses an already installed exact package before querying registries', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.eu.eps.r4#1.0.0-xtehr', 'hl7.fhir.eu.eps.r4');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.eu.eps.r4', '1.0.0-xtehr');

    expect(result).toMatchObject({
      success: true,
      packageId: 'hl7.fhir.eu.eps.r4',
      version: '1.0.0-xtehr',
    });
    expect(result.path).toContain('hl7.fhir.eu.eps.r4#1.0.0-xtehr');
  });

  it('uses an installed FHIR-version-suffixed package for the unsuffixed IG id', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.eu.eps.r4#1.0.0-xtehr', 'hl7.fhir.eu.eps.r4');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.eu.eps', '1.0.0-xtehr');

    expect(result).toMatchObject({
      success: true,
      packageId: 'hl7.fhir.eu.eps.r4',
      version: '1.0.0-xtehr',
    });
  });

  it('uses an installed stable FHIR-version-suffixed package for an unversioned IG id', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.uv.vulcan-schedule.r4#1.0.0', 'hl7.fhir.uv.vulcan-schedule.r4');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.uv.vulcan-schedule');

    expect(result).toMatchObject({
      success: true,
      packageId: 'hl7.fhir.uv.vulcan-schedule.r4',
      version: '1.0.0',
    });
  });

  it('selects the newest stable exact package independently of directory order', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'example.fhir#1.0.0', 'example.fhir');
    await writeInstalledPackage(cacheRoot, 'example.fhir#3.0.0-ballot', 'example.fhir');
    await writeInstalledPackage(cacheRoot, 'example.fhir#2.0.0', 'example.fhir');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    await expect(downloader.downloadAndInstall('example.fhir')).resolves.toMatchObject({
      success: true,
      packageId: 'example.fhir',
      version: '2.0.0',
    });
  });

  it('prefers the exact package id over an FHIR-version-suffixed fallback', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'example.fhir.r4#3.0.0', 'example.fhir.r4');
    await writeInstalledPackage(cacheRoot, 'example.fhir#2.0.0', 'example.fhir');

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        throw new Error('registry should not be queried');
      },
    } as any);

    await expect(downloader.downloadAndInstall('example.fhir')).resolves.toMatchObject({
      success: true,
      packageId: 'example.fhir',
      version: '2.0.0',
    });
  });

  it('does not treat an unrelated package namespace as an FHIR-version alias', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'example.fhir.unrelated#1.0.0', 'example.fhir.unrelated');
    const getPackageInfo = vi.fn().mockResolvedValue(null);
    const downloader = new PackageDownloader(cacheRoot, { getPackageInfo } as any);

    await expect(downloader.downloadAndInstall('example.fhir')).resolves.toMatchObject({
      success: false,
      packageId: 'example.fhir',
      error: 'Package not found in registry',
    });
    expect(getPackageInfo).toHaveBeenCalledTimes(1);
  });

  it('invalidates the persistent profile index after installing a package', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeFile(path.join(cacheRoot, 'sdloader-profile-index.json'), '{}');
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'example.fhir', version: '1.0.0' }),
      },
    ]);
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => ({
        packageId: 'example.fhir',
        version: '1.0.0',
        tarballUrl: 'https://packages.fhir.org/example.fhir/1.0.0',
      }),
      downloadPackageTarball: async () => archive,
    } as any);

    await expect(downloader.downloadAndInstall(
      'example.fhir',
      '1.0.0',
      { force: true },
    )).resolves.toMatchObject({ success: true });
    expect(await readFile(path.join(cacheRoot, 'example.fhir#1.0.0', 'package.tgz'))).toEqual(archive);
    await expect(access(path.join(cacheRoot, 'sdloader-profile-index.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('invalidates the persistent profile index before removing a package', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'example.fhir#1.0.0', 'example.fhir');
    await writeFile(path.join(cacheRoot, 'sdloader-profile-index.json'), '{}');
    const downloader = new PackageDownloader(cacheRoot);

    await expect(downloader.removePackage('example.fhir', '1.0.0')).resolves.toBe(true);
    await expect(access(path.join(cacheRoot, 'sdloader-profile-index.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not treat installed pre-release packages as latest for unversioned IG ids', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    await writeInstalledPackage(cacheRoot, 'hl7.fhir.uv.vulcan-schedule.r4#1.0.0-ballot', 'hl7.fhir.uv.vulcan-schedule.r4');
    let registryCalls = 0;

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        registryCalls++;
        return null;
      },
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.uv.vulcan-schedule');

    expect(registryCalls).toBe(1);
    expect(result).toMatchObject({
      success: false,
      packageId: 'hl7.fhir.uv.vulcan-schedule',
      version: 'unknown',
      error: 'Package not found in registry',
    });
  });

  it('shares concurrent downloads of the same package instead of returning in-progress errors', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    let registryCalls = 0;

    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        registryCalls++;
        await new Promise(resolve => setTimeout(resolve, 25));
        return null;
      },
    } as any);

    const [first, second] = await Promise.all([
      downloader.downloadAndInstall('kbv.ita.for', '1.1.0'),
      downloader.downloadAndInstall('kbv.ita.for', '1.1.0'),
    ]);

    expect(registryCalls).toBe(1);
    expect(first).toMatchObject({
      success: false,
      packageId: 'kbv.ita.for',
      version: '1.1.0',
      error: 'Package not found in registry',
    });
    expect(second).toEqual(first);
  });

  it('runs a concurrent force request after an in-progress non-force request', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    let releaseFirstMetadata!: () => void;
    const firstMetadataGate = new Promise<void>(resolve => {
      releaseFirstMetadata = resolve;
    });
    let registryCalls = 0;
    let downloadCalls = 0;
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        registryCalls++;
        if (registryCalls === 1) await firstMetadataGate;
        return {
          packageId: 'hl7.fhir.test',
          version: '1.0.0',
          tarballUrl: 'https://packages.fhir.org/hl7.fhir.test/1.0.0',
        };
      },
      downloadPackageTarball: async () => {
        downloadCalls++;
        return archive;
      },
    } as any);

    const regularDownload = downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    await vi.waitFor(() => expect(registryCalls).toBe(1));
    const forcedDownload = downloader.downloadAndInstall(
      'hl7.fhir.test',
      '1.0.0',
      { force: true },
    );
    releaseFirstMetadata();

    await expect(Promise.all([regularDownload, forcedDownload])).resolves.toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
    ]);
    expect(registryCalls).toBe(2);
    expect(downloadCalls).toBe(2);
  });

  it('serializes latest and explicit requests that resolve to the same package target', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>(resolve => {
      releaseDownload = resolve;
    });
    const getPackageInfo = vi.fn(async () => ({
      packageId: 'hl7.fhir.test',
      version: '1.0.0',
      tarballUrl: 'https://packages.fhir.org/hl7.fhir.test/1.0.0',
    }));
    const downloadPackageTarball = vi.fn(async () => {
      await downloadGate;
      return archive;
    });
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo,
      downloadPackageTarball,
    } as any);

    const latest = downloader.downloadAndInstall('hl7.fhir.test');
    await vi.waitFor(() => expect(downloadPackageTarball).toHaveBeenCalledTimes(1));
    const explicit = downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    await vi.waitFor(() => expect(getPackageInfo).toHaveBeenCalledTimes(2));
    releaseDownload();

    await expect(Promise.all([latest, explicit])).resolves.toEqual([
      expect.objectContaining({ success: true, version: '1.0.0' }),
      expect.objectContaining({ success: true, version: '1.0.0' }),
    ]);
    expect(downloadPackageTarball).toHaveBeenCalledTimes(1);
  });

  it('runs removal after an in-progress installation of the same target', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const packageDir = path.join(cacheRoot, 'hl7.fhir.test#1.0.0');
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>(resolve => {
      releaseDownload = resolve;
    });
    const downloadPackageTarball = vi.fn(async () => {
      await downloadGate;
      return archive;
    });
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => ({
        packageId: 'hl7.fhir.test',
        version: '1.0.0',
        tarballUrl: 'https://packages.fhir.org/hl7.fhir.test/1.0.0',
      }),
      downloadPackageTarball,
    } as any);

    const installation = downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    await vi.waitFor(() => expect(downloadPackageTarball).toHaveBeenCalledTimes(1));
    const removal = downloader.removePackage('hl7.fhir.test', '1.0.0');
    releaseDownload();

    await expect(installation).resolves.toMatchObject({ success: true });
    await expect(removal).resolves.toBe(true);
    await expect(access(packageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a per-call cache path that differs from the configured store', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const getPackageInfo = vi.fn();
    const downloader = new PackageDownloader(cacheRoot, { getPackageInfo } as any);

    await expect(downloader.downloadAndInstall('hl7.fhir.test', '1.0.0', {
      cachePath: path.join(cacheRoot, 'other'),
    })).resolves.toMatchObject({
      success: false,
      error: 'Per-call cache path does not match downloader cache path',
    });
    expect(getPackageInfo).not.toHaveBeenCalled();
  });

  it('rejects registry metadata for another package identity', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const downloadPackageTarball = vi.fn();
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => ({
        packageId: 'other.fhir',
        version: '1.0.0',
        tarballUrl: 'https://packages.fhir.org/other.fhir/1.0.0',
      }),
      downloadPackageTarball,
    } as any);

    await expect(downloader.downloadAndInstall(
      'hl7.fhir.test',
      '1.0.0',
    )).resolves.toMatchObject({
      success: false,
      error: 'Package installation failed',
    });
    expect(downloadPackageTarball).not.toHaveBeenCalled();
  });

  it.each([
    ['../outside', '1.0.0'],
    ['hl7.fhir.test', '../outside'],
    ['hl7.fhir.test/path', '1.0.0'],
  ])('rejects unsafe package references before registry access', async (packageId, version) => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const getPackageInfo = vi.fn();
    const downloader = new PackageDownloader(cacheRoot, { getPackageInfo } as any);

    await expect(downloader.downloadAndInstall(packageId, version)).resolves.toMatchObject({
      success: false,
      error: 'Invalid package identifier or version',
    });
    expect(getPackageInfo).not.toHaveBeenCalled();
  });

  it('rejects registry versions that cannot be contained in the package cache', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const downloadPackageTarball = vi.fn();
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => ({
        packageId: 'hl7.fhir.test',
        version: '../outside',
        tarballUrl: 'https://packages.fhir.org/test',
      }),
      downloadPackageTarball,
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    expect(result.success).toBe(false);
    expect(downloadPackageTarball).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'malformed',
      manifest: '{broken json',
    },
    {
      label: 'mismatched',
      manifest: JSON.stringify({ name: 'other.package', version: '1.0.0' }),
    },
  ])('repairs a $label installed-package manifest from the registry', async ({ manifest }) => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const packageDir = path.join(cacheRoot, 'hl7.fhir.test#1.0.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, 'package.json'), manifest);
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    let registryCalls = 0;
    const downloader = new PackageDownloader(cacheRoot, {
      getPackageInfo: async () => {
        registryCalls++;
        return {
          packageId: 'hl7.fhir.test',
          version: '1.0.0',
          tarballUrl: 'https://packages.fhir.org/hl7.fhir.test/1.0.0',
        };
      },
      downloadPackageTarball: async () => archive,
    } as any);

    const result = await downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');

    expect(result.success).toBe(true);
    expect(registryCalls).toBe(1);
    await expect(readFile(path.join(packageDir, 'package.json'), 'utf8'))
      .resolves.toContain('"name":"hl7.fhir.test"');
  });

  it('rejects archives whose manifest identity differs from the registry request', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const archive = await createArchive([
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'other.package', version: '1.0.0' }),
      },
    ]);
    const downloader = packageDownloaderForArchive(cacheRoot, archive);

    const result = await downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    expect(result.success).toBe(false);
    await expect(access(path.join(cacheRoot, 'hl7.fhir.test#1.0.0'))).rejects.toThrow();
  });

  it('ignores bounded macOS AppleDouble metadata in otherwise valid registry packages', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const archive = await createArchive([
      { name: '._package', content: 'appledouble metadata' },
      { name: 'package/._package.json', content: 'appledouble metadata' },
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    const downloader = packageDownloaderForArchive(cacheRoot, archive);

    await expect(downloader.downloadAndInstall('hl7.fhir.test', '1.0.0'))
      .resolves.toMatchObject({ success: true });
  });

  it('rejects archive traversal entries and leaves the parent directory untouched', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'records-packages-'));
    tempDirs.push(cacheRoot);
    const escapeName = `records-package-escape-${Date.now()}.txt`;
    const escapePath = path.join(path.dirname(cacheRoot), escapeName);
    const archive = await createArchive([
      { name: `../${escapeName}`, content: 'escape' },
      {
        name: 'package/package.json',
        content: JSON.stringify({ name: 'hl7.fhir.test', version: '1.0.0' }),
      },
    ]);
    const downloader = packageDownloaderForArchive(cacheRoot, archive);

    const result = await downloader.downloadAndInstall('hl7.fhir.test', '1.0.0');
    expect(result.success).toBe(false);
    await expect(access(escapePath)).rejects.toThrow();
  });
});

function packageDownloaderForArchive(cacheRoot: string, archive: Buffer): PackageDownloader {
  return new PackageDownloader(cacheRoot, {
    getPackageInfo: async () => ({
      packageId: 'hl7.fhir.test',
      version: '1.0.0',
      tarballUrl: 'https://packages.fhir.org/hl7.fhir.test/1.0.0',
    }),
    downloadPackageTarball: async () => archive,
  } as any);
}

async function createArchive(entries: Array<{ name: string; content: string }>): Promise<Buffer> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on('error', reject);
  });
  for (const entry of entries) pack.entry({ name: entry.name }, entry.content);
  pack.finalize();
  return complete;
}
