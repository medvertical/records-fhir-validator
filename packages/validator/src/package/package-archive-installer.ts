import * as fs from 'fs/promises';
import * as path from 'path';
import * as tar from 'tar';
import { logger } from '../logger.js';
import {
  isIgnorablePackageArchiveMetadata,
  isSafePackageArchiveEntry,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_TOTAL_BYTES,
  packageErrorMetadata,
} from './package-artifact-policy.js';
import { replaceInstalledPackageDirectory } from './package-directory-replacement.js';
import { resolveContainedTemporaryPath } from './package-downloader-paths.js';
import type { PackageInstallationStore } from './package-installation-store.js';
import { invalidatePackageProfileIndex } from './package-profile-index-metadata.js';

export class PackageArchiveInstaller {
  constructor(
    private readonly cachePath: string,
    private readonly installationStore: PackageInstallationStore,
  ) {}

  async install(
    tarball: Buffer,
    packageId: string,
    version: string,
  ): Promise<void> {
    await fs.mkdir(this.cachePath, { recursive: true });
    const temporaryDirectory = await fs.mkdtemp(
      resolveContainedTemporaryPath(this.cachePath, packageId),
    );
    try {
      await this.extract(tarball, temporaryDirectory);
      if (!await this.installationStore.verifyPackage(temporaryDirectory, packageId, version)) {
        throw new Error('Package verification failed');
      }
      await invalidatePackageProfileIndex(this.cachePath);
      await replaceInstalledPackageDirectory({
        cachePath: this.cachePath,
        packageId,
        version,
        replacementPath: temporaryDirectory,
      });
    } catch (error: unknown) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async extract(tarball: Buffer, targetPath: string): Promise<void> {
    try {
      logger.info('[PackageDownloader] Extracting package tarball', { bytes: tarball.length });
      const temporaryTarballPath = path.join(targetPath, '.temp-tarball.tgz');
      await fs.writeFile(temporaryTarballPath, tarball);
      try {
        const audit = { entryCount: 0, totalDeclaredBytes: 0, unsafeEntryFound: false };
        await tar.extract({
          file: temporaryTarballPath,
          cwd: targetPath,
          strict: true,
          preservePaths: false,
          filter: (entryPath, entry) => {
            const entryType = 'type' in entry ? entry.type : undefined;
            const entrySize = typeof entry.size === 'number' ? entry.size : undefined;
            audit.entryCount++;
            audit.totalDeclaredBytes += entrySize ?? 0;
            if (isIgnorablePackageArchiveMetadata(entryPath, entryType, entrySize)) return false;
            if (
              audit.entryCount > MAX_ARCHIVE_ENTRIES
              || audit.totalDeclaredBytes > MAX_ARCHIVE_TOTAL_BYTES
              || !isSafePackageArchiveEntry(entryPath, entryType, entrySize)
            ) {
              audit.unsafeEntryFound = true;
              return false;
            }
            return true;
          },
        });
        if (audit.unsafeEntryFound) throw new Error('Package archive contains an unsafe entry');
        logger.info('[PackageDownloader] Package tarball extraction complete', {
          entryCount: audit.entryCount,
          declaredBytes: audit.totalDeclaredBytes,
        });
      } finally {
        await fs.unlink(temporaryTarballPath).catch(() => undefined);
      }
    } catch (error: unknown) {
      logger.error(
        '[PackageDownloader] Package tarball extraction failed',
        packageErrorMetadata(error),
      );
      throw new Error('Failed to extract package tarball');
    }
  }
}
