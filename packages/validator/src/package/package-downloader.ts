import { PackageRegistryClient } from './package-registry-client.js';
import { logger } from '../logger.js';
import {
  packageErrorMetadata,
  packageReferenceMetadata,
} from './package-artifact-policy.js';
import {
  getDefaultPackageCachePath,
  isValidPackageReference,
  resolvePackageDownloadRequest,
  resolvePackageInstallationTarget,
} from './package-download-request-policy.js';
import type {
  PackageDownloadOptions,
  ResolvedPackageDownloadOptions,
} from './package-download-request-policy.js';
import { PackageInstallationStore } from './package-installation-store.js';
import { ForceAwareOperationLocks } from './package-operation-locks.js';
import { PackageArchiveInstaller } from './package-archive-installer.js';

export type { PackageDownloadOptions } from './package-download-request-policy.js';

export interface DownloadResult {
  success: boolean;
  packageId: string;
  version: string;
  path?: string;
  error?: string;
}

export class PackageDownloader {
  private registryClient: PackageRegistryClient;
  private cachePath: string;
  private installationStore: PackageInstallationStore;
  private archiveInstaller: PackageArchiveInstaller;
  private requestLocks = new ForceAwareOperationLocks();
  private installationLocks = new ForceAwareOperationLocks();

  constructor(
    cachePath?: string,
    registryClient?: PackageRegistryClient
  ) {
    this.cachePath = cachePath || getDefaultPackageCachePath();
    this.registryClient = registryClient || new PackageRegistryClient();
    this.installationStore = new PackageInstallationStore(this.cachePath);
    this.archiveInstaller = new PackageArchiveInstaller(this.cachePath, this.installationStore);
  }

  async downloadAndInstall(
    packageId: string,
    version?: string,
    options: PackageDownloadOptions = {}
  ): Promise<DownloadResult> {
    const request = resolvePackageDownloadRequest(
      packageId,
      version,
      this.cachePath,
      options,
    );
    if (!request.accepted) {
      return {
        success: false,
        packageId,
        version: version || 'unknown',
        error: request.error,
      };
    }
    return this.requestLocks.run(request.lockKey, request.options.force, () => (
      this.resolveAndInstallPackage(packageId, version, request.options)
    ));
  }

  private async resolveAndInstallPackage(
    packageId: string,
    version: string | undefined,
    options: ResolvedPackageDownloadOptions,
  ): Promise<DownloadResult> {
    try {
      if (!options.force) {
        const installed = await this.installationStore.findInstalledPackage(packageId, version);
        if (installed) {
          logger.info('[PackageDownloader] Package already installed locally', packageReferenceMetadata(installed.packageId, installed.version));
          return {
            success: true,
            packageId: installed.packageId,
            version: installed.version,
            path: installed.path
          };
        }
      }

      const infoStartTime = Date.now();
      logger.info('[PackageDownloader] Fetching package metadata', packageReferenceMetadata(packageId, version));
      const packageInfo = await this.registryClient.getPackageInfo(packageId, version);

      if (!packageInfo) {
        logger.warn('[PackageDownloader] Package not found in registry', packageReferenceMetadata(packageId, version));
        return {
          success: false,
          packageId,
          version: version || 'unknown',
          error: 'Package not found in registry'
        };
      }

      const infoTime = Date.now() - infoStartTime;
      const targetVersion = packageInfo.version;
      const packageDir = resolvePackageInstallationTarget(
        this.cachePath,
        packageId,
        packageInfo.packageId,
        targetVersion,
      );
      logger.info('[PackageDownloader] Package metadata retrieved', {
        ...packageReferenceMetadata(packageId, targetVersion),
        durationMs: infoTime,
      });

      const installationKey = `${packageInfo.packageId}#${targetVersion}`;
      return this.installationLocks.run(installationKey, options.force, () => (
        this.installResolvedPackage(packageId, targetVersion, packageDir, options)
      ));
    } catch (error: unknown) {
      logger.error('[PackageDownloader] Package installation failed', {
        ...packageReferenceMetadata(packageId, version),
        ...packageErrorMetadata(error),
      });
      return {
        success: false,
        packageId,
        version: version || 'unknown',
        error: 'Package installation failed',
      };
    }
  }

  private async installResolvedPackage(
    packageId: string,
    targetVersion: string,
    packageDir: string,
    options: ResolvedPackageDownloadOptions,
  ): Promise<DownloadResult> {
    try {
      if (!options.force && await this.installationStore.isPackageInstalled(
        packageDir,
        packageId,
        targetVersion,
      )) {
        logger.info('[PackageDownloader] Package already installed', packageReferenceMetadata(packageId, targetVersion));
        return {
          success: true,
          packageId,
          version: targetVersion,
          path: packageDir,
        };
      }
      const downloadStartTime = Date.now();
      logger.info('[PackageDownloader] Downloading package tarball', packageReferenceMetadata(packageId, targetVersion));
      const maxSize = options.maxPackageSize;
      const tarballBuffer = await this.registryClient.downloadPackageTarball(packageId, targetVersion, maxSize);

      if (!tarballBuffer) {
        logger.warn('[PackageDownloader] Package tarball download failed', packageReferenceMetadata(packageId, targetVersion));
        return {
          success: false,
          packageId,
          version: targetVersion,
          error: 'Failed to download tarball'
        };
      }

      const downloadTime = Date.now() - downloadStartTime;
      const tarballSizeMB = (tarballBuffer.length / 1024 / 1024).toFixed(2);
      logger.info('[PackageDownloader] Package tarball downloaded', {
        ...packageReferenceMetadata(packageId, targetVersion),
        bytes: tarballBuffer.length,
        durationMs: downloadTime,
      });

      if (tarballBuffer.length > maxSize) {
        logger.warn('[PackageDownloader] Package tarball exceeds configured size limit', {
          ...packageReferenceMetadata(packageId, targetVersion),
          bytes: tarballBuffer.length,
          maxBytes: maxSize,
        });
        return {
          success: false,
          packageId,
          version: targetVersion,
          error: `Package too large: ${tarballSizeMB} MB (max: ${maxSize / 1024 / 1024} MB)`
        };
      }

      await this.archiveInstaller.install(
        tarballBuffer,
        packageId,
        targetVersion,
      );
      logger.info('[PackageDownloader] Package installed', packageReferenceMetadata(packageId, targetVersion));
      return {
        success: true,
        packageId,
        version: targetVersion,
        path: packageDir,
      };

    } catch (error: unknown) {
      logger.error('[PackageDownloader] Package installation failed', {
        ...packageReferenceMetadata(packageId, targetVersion),
        ...packageErrorMetadata(error),
      });
      return {
        success: false,
        packageId,
        version: targetVersion,
        error: 'Package installation failed',
      };
    }
  }

  async listInstalledPackages(): Promise<string[]> {
    return this.installationStore.listInstalledPackages();
  }

  async removePackage(packageId: string, version: string): Promise<boolean> {
    if (!isValidPackageReference(packageId, version)) return false;
    return this.installationLocks.runExclusive(
      `${packageId}#${version}`,
      () => this.installationStore.removePackage(packageId, version),
    );
  }

  getCachePath(): string {
    return this.cachePath;
  }
}
