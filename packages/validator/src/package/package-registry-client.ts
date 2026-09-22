/**
 * FHIR Package Registry API Client
 * 
 * Communicates with packages.fhir.org to fetch package metadata and download tarballs.
 * 
 * API Endpoints:
 * - List versions: GET https://packages.fhir.org/<packageId>
 * - Download: GET https://packages.fhir.org/<packageId>/<version>
 * - Search by canonical: GET https://packages.fhir.org?canonical=<url>
 */

import { logger } from '../logger.js';
import { detectPackageForProfile } from './package-profile-detector.js';
import {
  packageErrorMetadata,
  packageReferenceMetadata,
  isSafePackageId,
  isSafePackageVersion,
  resolvePackageSizeLimit,
} from './package-artifact-policy.js';
import type { PackageInfo, PackageManifest } from './package-registry-types.js';
import { PackageManifestCache } from './package-manifest-cache.js';
import { resolvePackageManifestVersion } from './package-manifest-version.js';
import { downloadPackageArtifact, fetchManifestFromRegistry } from './package-registry-http.js';
export type { PackageInfo, PackageManifest, PackageVersion } from './package-registry-types.js';

// ============================================================================
// Types
// ============================================================================

const DEFAULT_REGISTRY_TIMEOUT_MS = 10_000;

function configuredRegistryTimeout(): number {
  const value = Number(process.env.FHIR_PACKAGE_REGISTRY_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 120_000)
    : DEFAULT_REGISTRY_TIMEOUT_MS;
}

// ============================================================================
// Package Registry Client
// ============================================================================

export class PackageRegistryClient {
  private fhirRegistryUrl: string = 'https://packages.fhir.org';
  private simplifierUrl: string = 'https://packages.simplifier.net';
  private timeout: number;
  private manifestCache: PackageManifestCache;
  private manifestRequests = new Map<string, Promise<PackageManifest | null>>();
  private manifestCacheRevision = 0;

  constructor(
    timeout: number = configuredRegistryTimeout(),
    maxCacheEntries: number = 128
  ) {
    this.timeout = Number.isSafeInteger(timeout) && timeout > 0
      ? Math.min(timeout, 120_000)
      : 10_000;
    this.manifestCache = new PackageManifestCache(maxCacheEntries);
  }

  /**
   * Fetch package manifest (list of versions)
   * Tries Simplifier.net first for UK Core packages, then FHIR registry
   */
  async fetchPackageManifest(packageId: string): Promise<PackageManifest | null> {
    if (!isSafePackageId(packageId)) return null;
    try {
      // Check cache first
      const cached = this.manifestCache.get(packageId);
      if (cached) {
        logger.info('[PackageRegistry] Using cached manifest', packageReferenceMetadata(packageId));
        return cached;
      }
      const pending = this.manifestRequests.get(packageId);
      if (pending) return pending;

      const cacheRevision = this.manifestCacheRevision;
      const request = this.resolvePackageManifest(packageId, cacheRevision).finally(() => {
        if (this.manifestRequests.get(packageId) === request) {
          this.manifestRequests.delete(packageId);
        }
      });
      this.manifestRequests.set(packageId, request);
      return request;

    } catch (error: unknown) {
      logger.error('[PackageRegistry] Manifest resolution failed', {
        ...packageReferenceMetadata(packageId),
        ...packageErrorMetadata(error),
      });
      return null;
    }
  }

  private async resolvePackageManifest(
    packageId: string,
    cacheRevision: number,
  ): Promise<PackageManifest | null> {
    const simplifierFirst = this.shouldUseSimplifier(packageId);
    const registries = simplifierFirst
      ? [this.simplifierUrl, this.fhirRegistryUrl]
      : [this.fhirRegistryUrl, this.simplifierUrl];

    let manifest: PackageManifest | null = null;
    for (const registry of registries) {
      logger.info('[PackageRegistry] Trying package registry', {
        ...packageReferenceMetadata(packageId),
        registry: this.registryName(registry),
      });
      manifest = await this.fetchFromRegistry(packageId, registry);
      if (manifest) break;
    }

    if (!manifest) {
      logger.warn('[PackageRegistry] Package not found in any registry', packageReferenceMetadata(packageId));
      return null;
    }
    if (this.manifestCacheRevision === cacheRevision) {
      this.manifestCache.set(packageId, manifest);
    }
    logger.info('[PackageRegistry] Package manifest resolved', {
      ...packageReferenceMetadata(packageId),
      versionCount: Object.keys(manifest.versions).length,
    });
    return structuredClone(manifest);
  }

  /**
   * Fetch from a specific registry URL
   */
  private async fetchFromRegistry(packageId: string, registryUrl: string): Promise<PackageManifest | null> {
    return fetchManifestFromRegistry({
      packageId,
      registryUrl,
      registryName: this.registryName(registryUrl),
      timeoutMs: this.timeout,
    });
  }

  /**
   * Determine if package should try Simplifier.net first
   */
  private shouldUseSimplifier(packageId: string): boolean {
    // UK Core packages are on Simplifier (uk.core.r4.v2, etc.)
    if (packageId.includes('uk.core') || packageId.includes('nhsdigital') ||
      packageId.includes('hl7.fhir.uk')) {
      return true;
    }

    // Some German packages prefer Simplifier
    if (packageId.includes('de.gematik') || packageId.includes('kbv')) {
      return true;
    }

    // Default: try FHIR registry first
    return false;
  }

  /**
   * Get package info for a specific version (or latest)
   */
  async getPackageInfo(packageId: string, version?: string): Promise<PackageInfo | null> {
    if (!isSafePackageId(packageId) || (version !== undefined && !isSafePackageVersion(version))) {
      return null;
    }
    try {
      const manifest = await this.fetchPackageManifest(packageId);
      if (!manifest) {
        return null;
      }

      // Determine version to use. Some published canonicals use short
      // SemVer (for example `|2.7`) while the package registry publishes the
      // package as `2.7.0`.
      const targetVersion = resolvePackageManifestVersion(manifest, version);
      if (!targetVersion) {
        logger.warn('[PackageRegistry] Package manifest has no usable version', packageReferenceMetadata(packageId));
        return null;
      }

      const versionInfo = manifest.versions[targetVersion];
      if (
        !versionInfo
        || !isSafePackageVersion(targetVersion)
        || versionInfo.name !== packageId
        || versionInfo.version !== targetVersion
        || typeof versionInfo.dist?.tarball !== 'string'
      ) {
        logger.warn('[PackageRegistry] Requested package version is unavailable', packageReferenceMetadata(packageId, targetVersion));
        return null;
      }

      return {
        packageId,
        version: targetVersion,
        tarballUrl: versionInfo.dist.tarball,
        fhirVersion: versionInfo.fhirVersion
      };

    } catch (error: unknown) {
      logger.error('[PackageRegistry] Package metadata lookup failed', {
        ...packageReferenceMetadata(packageId, version),
        ...packageErrorMetadata(error),
      });
      return null;
    }
  }

  /**
   * Download package tarball
   */
  async downloadPackageTarball(
    packageId: string,
    version: string,
    maxBytes = 500 * 1024 * 1024,
  ): Promise<Buffer | null> {
    const safeMaxBytes = resolvePackageSizeLimit(maxBytes);
    if (!isSafePackageId(packageId) || !isSafePackageVersion(version) || safeMaxBytes === null) return null;
    try {
      const packageInfo = await this.getPackageInfo(packageId, version);
      if (!packageInfo) {
        return null;
      }

      return downloadPackageArtifact({ packageInfo, maxBytes: safeMaxBytes, timeoutMs: this.timeout });

    } catch (error: unknown) {
      logger.error('[PackageRegistry] Package tarball download failed', {
        ...packageReferenceMetadata(packageId, version),
        ...packageErrorMetadata(error),
      });
      return null;
    }
  }

  /**
   * Detect package ID from profile URL
   * First tries known patterns, then falls back to generic ProfilePackageMapper
   */
  async detectPackageForProfile(profileUrl: string): Promise<string | null> {
    return detectPackageForProfile(profileUrl);
  }

  private registryName(registryUrl: string): 'fhir' | 'simplifier' | 'unknown' {
    if (registryUrl === this.fhirRegistryUrl) return 'fhir';
    if (registryUrl === this.simplifierUrl) return 'simplifier';
    return 'unknown';
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.manifestCacheRevision++;
    this.manifestCache.clear();
    this.manifestRequests.clear();
    logger.info('[PackageRegistry] Cache cleared');
  }

  getCacheStats(): {
    size: number;
    maxSize: number;
    packageIds: string[];
    hits: number;
    misses: number;
    evictions: number;
    staleEvictions: number;
  } {
    return this.manifestCache.getStats();
  }
}
