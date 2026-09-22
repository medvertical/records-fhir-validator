import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logger.js';
import {
  isSafePackageId,
  isSafePackageVersion,
  packageErrorMetadata,
  packageReferenceMetadata,
} from './package-artifact-policy.js';
import {
  isPreReleasePackageVersion,
  isSafeInstalledPackageDirectoryName,
  resolveContainedPackagePath,
} from './package-downloader-paths.js';
import { compareVersions } from '../package-resolver/version-comparator.js';
import { invalidatePackageProfileIndex } from './package-profile-index-metadata.js';
import { reportUnreadablePackageStore } from './package-store-diagnostics.js';

export interface InstalledPackage {
  packageId: string;
  version: string;
  path: string;
}

interface PackageManifest {
  name?: string;
  version?: string;
}

export class PackageInstallationStore {
  constructor(private readonly cachePath: string) {}

  async verifyPackage(
    packagePath: string,
    expectedPackageId: string,
    expectedVersion: string,
  ): Promise<boolean> {
    const packageJsonPath = path.join(packagePath, 'package', 'package.json');
    try {
      await fs.access(packageJsonPath);
    } catch {
      logger.error('[PackageDownloader] Package verification failed: manifest missing');
      return false;
    }

    try {
      const packageJson = parsePackageManifest(await fs.readFile(packageJsonPath, 'utf-8'));
      if (!matchesExpectedManifest(packageJson, expectedPackageId, expectedVersion)) {
        logger.error('[PackageDownloader] Package verification failed: manifest identity mismatch');
        return false;
      }

      logger.info(
        '[PackageDownloader] Package verified',
        packageReferenceMetadata(expectedPackageId, expectedVersion),
      );
      return true;
    } catch {
      logger.error('[PackageDownloader] Package verification failed: invalid manifest');
      return false;
    }
  }

  async isPackageInstalled(
    packagePath: string,
    expectedPackageId?: string,
    expectedVersion?: string,
  ): Promise<boolean> {
    const manifest = await this.readInstalledPackageManifest(packagePath);
    if (
      !manifest
      || !isSafePackageId(manifest.name ?? '')
      || !isSafePackageVersion(manifest.version ?? '')
    ) {
      return false;
    }
    if (expectedPackageId && manifest.name !== expectedPackageId) return false;
    if (expectedVersion && manifest.version !== expectedVersion) return false;
    return true;
  }

  async findInstalledPackage(packageId: string, version?: string): Promise<InstalledPackage | null> {
    if (!isSafePackageId(packageId) || (version !== undefined && !isSafePackageVersion(version))) {
      return null;
    }

    try {
      const entries = await fs.readdir(this.cachePath, { withFileTypes: true });
      const candidates = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => isSafeInstalledPackageDirectoryName(name))
        .filter(name => this.matchesInstalledPackageName(name, packageId, version))
        .sort();
      const installedPackages: InstalledPackage[] = [];

      for (const candidate of candidates) {
        const packageDir = path.join(this.cachePath, candidate);
        const [namePart, versionPart] = candidate.split('#');
        const manifest = await this.readInstalledPackageManifest(packageDir);
        if (!matchesExpectedManifest(manifest, namePart, versionPart)) continue;
        const installedVersion = manifest.version;
        if (!version && isPreReleasePackageVersion(installedVersion)) {
          logger.info(
            '[PackageDownloader] Skipping installed pre-release for unversioned request',
            packageReferenceMetadata(manifest.name, installedVersion),
          );
          continue;
        }

        installedPackages.push({
          packageId: manifest.name,
          version: installedVersion,
          path: packageDir,
        });
      }

      installedPackages.sort((left, right) => {
        const leftIsExact = left.packageId === packageId;
        const rightIsExact = right.packageId === packageId;
        if (leftIsExact !== rightIsExact) return leftIsExact ? -1 : 1;

        const byVersion = compareVersions(right.version, left.version);
        return byVersion !== 0
          ? byVersion
          : left.packageId.localeCompare(right.packageId);
      });
      return installedPackages[0] ?? null;
    } catch {
      return null;
    }
  }

  async listInstalledPackages(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.cachePath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory() && isSafeInstalledPackageDirectoryName(entry.name))
        .map(entry => entry.name);
    } catch (error: unknown) {
      reportUnreadablePackageStore('PackageInstallationStore', this.cachePath, error);
      return [];
    }
  }

  async removePackage(packageId: string, version: string): Promise<boolean> {
    if (!isSafePackageId(packageId) || !isSafePackageVersion(version)) return false;
    try {
      const packageDir = resolveContainedPackagePath(this.cachePath, packageId, version);
      if (!await this.isPackageInstalled(packageDir, packageId, version)) {
        logger.warn(
          '[PackageDownloader] Package is not installed',
          packageReferenceMetadata(packageId, version),
        );
        return false;
      }

      await invalidatePackageProfileIndex(this.cachePath);
      await fs.rm(packageDir, { recursive: true, force: true });
      logger.info('[PackageDownloader] Package removed', packageReferenceMetadata(packageId, version));
      return true;
    } catch (error: unknown) {
      logger.error('[PackageDownloader] Package removal failed', {
        ...packageReferenceMetadata(packageId, version),
        ...packageErrorMetadata(error),
      });
      return false;
    }
  }

  private matchesInstalledPackageName(name: string, packageId: string, version?: string): boolean {
    const [installedId, installedVersion] = name.split('#');
    if (
      !installedId
      || !installedVersion
      || !isSafePackageId(installedId)
      || !isSafePackageVersion(installedVersion)
    ) {
      return false;
    }
    if (version && installedVersion !== version) return false;
    return installedId === packageId || isFhirVersionAlias(packageId, installedId);
  }

  private async readInstalledPackageManifest(
    packageDir: string,
  ): Promise<PackageManifest | null> {
    try {
      const content = await fs.readFile(path.join(packageDir, 'package', 'package.json'), 'utf-8');
      return parsePackageManifest(content);
    } catch {
      return null;
    }
  }
}

function parsePackageManifest(content: string): PackageManifest | null {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = Reflect.get(value, 'name');
  const version = Reflect.get(value, 'version');
  return {
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof version === 'string' ? { version } : {}),
  };
}

function matchesExpectedManifest(
  manifest: PackageManifest | null,
  expectedPackageId: string,
  expectedVersion: string,
): manifest is Required<PackageManifest> {
  return Boolean(
    manifest
    && isSafePackageId(manifest.name ?? '')
    && isSafePackageVersion(manifest.version ?? '')
    && manifest.name === expectedPackageId
    && manifest.version === expectedVersion,
  );
}

function isFhirVersionAlias(requestedId: string, installedId: string): boolean {
  return /^(?:r4|r4b|r5|r6)$/.test(installedId.slice(requestedId.length + 1))
    && installedId.startsWith(`${requestedId}.`);
}
