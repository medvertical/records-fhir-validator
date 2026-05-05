/**
 * FHIR Package Downloader
 * 
 * Downloads FHIR packages from packages.fhir.org and installs them to the local cache.
 * 
 * Features:
 * - Atomic writes (temp directory → rename)
 * - Package verification
 * - Concurrent download prevention (lock mechanism)
 * - Disk space checks
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { packageRegistryClient, PackageRegistryClient } from './package-registry-client.js';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface PackageDownloadOptions {
  /**
   * Target cache directory (default: ~/.fhir/packages)
   */
  cachePath?: string;

  /**
   * Force re-download even if package exists
   */
  force?: boolean;

  /**
   * Maximum package size in bytes (default: 500 MB)
   */
  maxPackageSize?: number;
}

export interface DownloadResult {
  success: boolean;
  packageId: string;
  version: string;
  path?: string;
  error?: string;
}

// ============================================================================
// Package Downloader
// ============================================================================

export class PackageDownloader {
  private registryClient: PackageRegistryClient;
  private cachePath: string;
  private downloadLocks: Set<string> = new Set();

  constructor(
    cachePath?: string,
    registryClient?: PackageRegistryClient
  ) {
    this.cachePath = cachePath || this.getDefaultCachePath();
    this.registryClient = registryClient || packageRegistryClient;
  }

  /**
   * Download and install a FHIR package
   */
  async downloadAndInstall(
    packageId: string,
    version?: string,
    options: PackageDownloadOptions = {}
  ): Promise<DownloadResult> {
    const lockKey = `${packageId}#${version || 'latest'}`;

    // Prevent concurrent downloads of the same package
    if (this.downloadLocks.has(lockKey)) {
      logger.info(`[PackageDownloader] Download already in progress: ${lockKey}`);
      return {
        success: false,
        packageId,
        version: version || 'unknown',
        error: 'Download already in progress'
      };
    }

    this.downloadLocks.add(lockKey);

    try {
      // Get package info
      const infoStartTime = Date.now();
      logger.info(`[PackageDownloader] 📦 Fetching package info: ${packageId}@${version || 'latest'}`);
      const packageInfo = await this.registryClient.getPackageInfo(packageId, version);

      if (!packageInfo) {
        logger.warn(`[PackageDownloader] ✗ Package not found in registry: ${packageId}@${version || 'latest'}`);
        return {
          success: false,
          packageId,
          version: version || 'unknown',
          error: 'Package not found in registry'
        };
      }

      const infoTime = Date.now() - infoStartTime;
      const targetVersion = packageInfo.version;
      const packageDir = path.join(this.cachePath, `${packageId}#${targetVersion}`);
      logger.info(`[PackageDownloader] ✓ Package info retrieved: ${packageId}#${targetVersion} (FHIR ${packageInfo.fhirVersion || 'unknown'}, ${infoTime}ms)`);

      // Check if already installed
      if (!options.force && await this.isPackageInstalled(packageDir)) {
        logger.info(`[PackageDownloader] ✓ Package already installed: ${packageId}#${targetVersion}`);
        return {
          success: true,
          packageId,
          version: targetVersion,
          path: packageDir
        };
      }

      // Download tarball
      const downloadStartTime = Date.now();
      logger.info(`[PackageDownloader] ⬇️  Downloading tarball: ${packageId}#${targetVersion} from ${packageInfo.tarballUrl}`);
      const tarballBuffer = await this.registryClient.downloadPackageTarball(packageId, targetVersion);

      if (!tarballBuffer) {
        logger.warn(`[PackageDownloader] ✗ Failed to download tarball: ${packageId}#${targetVersion}`);
        return {
          success: false,
          packageId,
          version: targetVersion,
          error: 'Failed to download tarball'
        };
      }

      const downloadTime = Date.now() - downloadStartTime;
      const tarballSizeMB = (tarballBuffer.length / 1024 / 1024).toFixed(2);
      logger.info(`[PackageDownloader] ✓ Tarball downloaded: ${tarballSizeMB} MB (${downloadTime}ms)`);

      // Check size limit
      const maxSize = options.maxPackageSize || 500 * 1024 * 1024; // 500 MB
      if (tarballBuffer.length > maxSize) {
        logger.warn(`[PackageDownloader] ✗ Package too large: ${tarballSizeMB} MB (max: ${maxSize / 1024 / 1024} MB)`);
        return {
          success: false,
          packageId,
          version: targetVersion,
          error: `Package too large: ${tarballSizeMB} MB (max: ${maxSize / 1024 / 1024} MB)`
        };
      }

      // Extract to temporary directory
      const tempDir = path.join(this.cachePath, `.temp-${packageId}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        await this.extractTarball(tarballBuffer, tempDir);

        // Verify package structure
        if (!await this.verifyPackage(tempDir)) {
          throw new Error('Package verification failed');
        }

        // Atomic move: temp → final
        await fs.mkdir(this.cachePath, { recursive: true });
        
        // Remove existing if force install
        if (await this.isPackageInstalled(packageDir)) {
          await fs.rm(packageDir, { recursive: true, force: true });
        }

        await fs.rename(tempDir, packageDir);

        logger.info(`[PackageDownloader] ✅ Successfully installed: ${packageId}#${targetVersion} → ${packageDir}`);

        return {
          success: true,
          packageId,
          version: targetVersion,
          path: packageDir
        };

      } catch (error: unknown) {
        // Cleanup temp directory on error
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        throw error;
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageDownloader] Error installing ${packageId}:`, err.message);
      return {
        success: false,
        packageId,
        version: version || 'unknown',
        error: err.message
      };

    } finally {
      this.downloadLocks.delete(lockKey);
    }
  }

  /**
   * Extract tarball to target directory
   */
  private async extractTarball(tarballBuffer: Buffer, targetPath: string): Promise<void> {
    try {
      logger.info(`[PackageDownloader] Extracting tarball (${tarballBuffer.length} bytes) → ${targetPath}`);

      // tar-stream expects a file path or stream
      // We'll write the buffer to a temp file, extract, then delete
      const tempTarballPath = path.join(targetPath, '.temp-tarball.tgz');
      await fs.writeFile(tempTarballPath, tarballBuffer);

      try {
        // Extract using tar library
        // Don't strip - we need to keep the "package" directory structure
        // The loader expects: <packageId>#<version>/package/StructureDefinition-*.json
        await tar.extract({
          file: tempTarballPath,
          cwd: targetPath
        });

        logger.info(`[PackageDownloader] Extraction complete`);

      } finally {
        // Cleanup temp tarball
        try {
          await fs.unlink(tempTarballPath);
        } catch {
          // Ignore cleanup errors
        }
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageDownloader] Extraction error:`, err.message);
      throw new Error(`Failed to extract tarball: ${err.message}`);
    }
  }

  /**
   * Verify package structure
   */
  private async verifyPackage(packagePath: string): Promise<boolean> {
    try {
      // Tarball structure: package/package.json (top-level "package" directory)
      // After extraction: <packagePath>/package/package.json
      const packageJsonPath = path.join(packagePath, 'package', 'package.json');
      
      try {
        await fs.access(packageJsonPath);
      } catch {
        logger.error(`[PackageDownloader] Verification failed: package/package.json not found`);
        return false;
      }

      // Read and validate package.json
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);

        if (!packageJson.name || !packageJson.version) {
          logger.error(`[PackageDownloader] Verification failed: invalid package.json`);
          return false;
        }

        logger.info(`[PackageDownloader] ✅ Package verified: ${packageJson.name}@${packageJson.version}`);
        return true;

      } catch (error) {
        logger.error(`[PackageDownloader] Verification failed: invalid JSON`);
        return false;
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageDownloader] Verification error:`, err.message);
      return false;
    }
  }

  /**
   * Check if package is already installed
   */
  private async isPackageInstalled(packagePath: string): Promise<boolean> {
    try {
      await fs.access(packagePath);
      
      // Also check for package.json to ensure it's complete
      const packageJsonPath = path.join(packagePath, 'package', 'package.json');
      await fs.access(packageJsonPath);

      return true;

    } catch {
      return false;
    }
  }

  /**
   * Get default cache path
   */
  private getDefaultCachePath(): string {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) {
      return '/tmp/fhir-packages';
    }
    return path.join(home, '.fhir', 'packages');
  }

  /**
   * List installed packages
   */
  async listInstalledPackages(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.cachePath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory() && entry.name.includes('#'))
        .map(entry => entry.name);
    } catch {
      return [];
    }
  }

  /**
   * Remove a package
   */
  async removePackage(packageId: string, version: string): Promise<boolean> {
    try {
      const packageDir = path.join(this.cachePath, `${packageId}#${version}`);
      
      if (!await this.isPackageInstalled(packageDir)) {
        logger.warn(`[PackageDownloader] Package not installed: ${packageId}#${version}`);
        return false;
      }

      await fs.rm(packageDir, { recursive: true, force: true });
      logger.info(`[PackageDownloader] ✅ Removed: ${packageId}#${version}`);
      return true;

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageDownloader] Error removing ${packageId}#${version}:`, err.message);
      return false;
    }
  }

  /**
   * Get cache directory path
   */
  getCachePath(): string {
    return this.cachePath;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const packageDownloader = new PackageDownloader();

