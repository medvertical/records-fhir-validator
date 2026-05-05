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

import fetch from 'node-fetch';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface PackageManifest {
  name: string;
  'dist-tags': {
    latest?: string;
    [key: string]: string | undefined;
  };
  versions: {
    [version: string]: PackageVersion;
  };
}

export interface PackageVersion {
  name: string;
  version: string;
  description?: string;
  dist: {
    tarball: string;
    shasum?: string;
  };
  fhirVersion?: string | string[];
  dependencies?: Record<string, string>;
}

export interface PackageInfo {
  packageId: string;
  version: string;
  tarballUrl: string;
  fhirVersion?: string | string[];
}

// ============================================================================
// Package Registry Client
// ============================================================================

export class PackageRegistryClient {
  private fhirRegistryUrl: string = 'https://packages.fhir.org';
  private simplifierUrl: string = 'https://packages.simplifier.net';
  private timeout: number;
  private cache: Map<string, { data: PackageManifest; timestamp: number }> = new Map();
  private cacheTTL: number = 60 * 60 * 1000; // 1 hour

  constructor(
    baseUrl?: string,
    timeout: number = 10000  // Reduced from 30s to 10s to prevent hangs
  ) {
    // If baseUrl provided, use it as fhirRegistryUrl for backwards compatibility
    if (baseUrl) {
      this.fhirRegistryUrl = baseUrl;
    }
    this.timeout = timeout;
  }

  /**
   * Fetch package manifest (list of versions)
   * Tries Simplifier.net first for UK Core packages, then FHIR registry
   */
  async fetchPackageManifest(packageId: string): Promise<PackageManifest | null> {
    try {
      // Check cache first
      const cached = this.cache.get(packageId);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        logger.info(`[PackageRegistry] Using cached manifest for ${packageId}`);
        return cached.data;
      }

      // Determine which registry to try first based on package ID
      const shouldTrySimplifierFirst = this.shouldUseSimplifier(packageId);

      let manifest: PackageManifest | null = null;

      if (shouldTrySimplifierFirst) {
        // Try Simplifier first
        logger.info(`[PackageRegistry] Trying Simplifier.net for ${packageId}`);
        manifest = await this.fetchFromRegistry(packageId, this.simplifierUrl);

        if (!manifest) {
          // Fall back to FHIR registry
          logger.info(`[PackageRegistry] Simplifier failed, trying FHIR registry for ${packageId}`);
          manifest = await this.fetchFromRegistry(packageId, this.fhirRegistryUrl);
        }
      } else {
        // Try FHIR registry first
        logger.info(`[PackageRegistry] Trying FHIR registry for ${packageId}`);
        manifest = await this.fetchFromRegistry(packageId, this.fhirRegistryUrl);

        if (!manifest) {
          // Fall back to Simplifier
          logger.info(`[PackageRegistry] FHIR registry failed, trying Simplifier.net for ${packageId}`);
          manifest = await this.fetchFromRegistry(packageId, this.simplifierUrl);
        }
      }

      if (manifest) {
        // Cache the manifest
        this.cache.set(packageId, {
          data: manifest,
          timestamp: Date.now()
        });
        logger.info(`[PackageRegistry] Found ${Object.keys(manifest.versions).length} versions for ${packageId}`);
      } else {
        logger.warn(`[PackageRegistry] Package not found in any registry: ${packageId}`);
      }

      return manifest;

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageRegistry] Error fetching manifest for ${packageId}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch from a specific registry URL
   */
  private async fetchFromRegistry(packageId: string, registryUrl: string): Promise<PackageManifest | null> {
    const startTime = Date.now();
    const url = `${registryUrl}/${packageId}`;

    try {
      logger.info(`[PackageRegistry] Fetching manifest from ${url} (timeout: ${this.timeout}ms)`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        logger.warn(`[PackageRegistry] ⏱️ Timeout after ${this.timeout}ms fetching ${packageId} from ${registryUrl}`);
      }, this.timeout);

      const response = await fetch(url, {
        signal: controller.signal as AbortSignal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Records-FHIR-Validator/1.0'
        }
      });

      clearTimeout(timeoutId);
      const fetchTime = Date.now() - startTime;

      if (!response.ok) {
        if (response.status === 404) {
          logger.info(`[PackageRegistry] Package ${packageId} not found (404) in ${registryUrl} (${fetchTime}ms)`);
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const manifest = await response.json() as PackageManifest;
      const totalTime = Date.now() - startTime;
      logger.info(`[PackageRegistry] ✅ Successfully fetched manifest for ${packageId} from ${registryUrl} (${totalTime}ms)`);
      return manifest;

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const totalTime = Date.now() - startTime;
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        logger.warn(`[PackageRegistry] ⏱️ Timeout after ${totalTime}ms fetching ${packageId} from ${registryUrl}`);
      } else if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        logger.warn(`[PackageRegistry] Network error fetching ${packageId} from ${registryUrl}: ${err.message}`);
      } else {
        logger.warn(`[PackageRegistry] Error fetching ${packageId} from ${registryUrl} (${totalTime}ms): ${err.message}`);
      }
      return null;
    }
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
    try {
      const manifest = await this.fetchPackageManifest(packageId);
      if (!manifest) {
        return null;
      }

      // Determine version to use
      const targetVersion = version || manifest['dist-tags'].latest || this.getLatestVersion(manifest);
      if (!targetVersion) {
        logger.warn(`[PackageRegistry] No version found for ${packageId}`);
        return null;
      }

      const versionInfo = manifest.versions[targetVersion];
      if (!versionInfo) {
        logger.warn(`[PackageRegistry] Version ${targetVersion} not found for ${packageId}`);
        return null;
      }

      return {
        packageId,
        version: targetVersion,
        tarballUrl: versionInfo.dist.tarball,
        fhirVersion: versionInfo.fhirVersion
      };

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageRegistry] Error getting package info for ${packageId}:`, err.message);
      return null;
    }
  }

  /**
   * Download package tarball
   */
  async downloadPackageTarball(packageId: string, version: string): Promise<Buffer | null> {
    try {
      const packageInfo = await this.getPackageInfo(packageId, version);
      if (!packageInfo) {
        return null;
      }

      logger.info(`[PackageRegistry] Downloading tarball: ${packageInfo.tarballUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(packageInfo.tarballUrl, {
        signal: controller.signal as AbortSignal,
        headers: {
          'User-Agent': 'Records-FHIR-Validator/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      logger.info(`[PackageRegistry] Downloaded ${buffer.byteLength} bytes for ${packageId}#${version}`);

      return Buffer.from(buffer);

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') {
        logger.error(`[PackageRegistry] Timeout downloading tarball for ${packageId}#${version}`);
      } else {
        logger.error(`[PackageRegistry] Error downloading tarball for ${packageId}#${version}:`, err.message);
      }
      return null;
    }
  }

  /**
   * Detect package ID from profile URL
   * First tries known patterns, then falls back to generic ProfilePackageMapper
   */
  async detectPackageForProfile(profileUrl: string): Promise<string | null> {
    logger.info(`[PackageRegistry] Detecting package for profile: ${profileUrl}`);

    // ========================================================================
    // Fast path: Known patterns for common packages
    // ========================================================================

    // US Core: http://hl7.org/fhir/us/core/StructureDefinition/...
    if (profileUrl.includes('hl7.org/fhir/us/core')) {
      logger.info(`[PackageRegistry] ✓ Pattern match: US Core → hl7.fhir.us.core`);
      return 'hl7.fhir.us.core';
    }

    // UK Core: https://fhir.hl7.org.uk/StructureDefinition/...
    // Note: UK Core packages are on Simplifier.net
    if (profileUrl.includes('fhir.hl7.org.uk') || profileUrl.includes('fhir.uk')) {
      // UK Core package name on Simplifier: uk.core.r4.v2
      return 'uk.core.r4.v2';
    }

    // German Basisprofile: http://fhir.de/StructureDefinition/...
    if (profileUrl.includes('fhir.de') || profileUrl.includes('basisprofil')) {
      return 'de.basisprofil.r4';
    }

    // ISiP: https://gematik.de/fhir/isip/...
    if (profileUrl.includes('gematik.de') && profileUrl.includes('isip')) {
      return 'de.gematik.isip-basismodul';
    }

    // ISiK: https://gematik.de/fhir/isik/...
    if (profileUrl.includes('gematik.de') && profileUrl.includes('isik')) {
      return 'de.gematik.isik-basismodul';
    }

    // MII: https://www.medizininformatik-initiative.de/fhir/...
    if (profileUrl.includes('medizininformatik') || profileUrl.includes('mii')) {
      const normalizedProfileUrl = profileUrl.toLowerCase();
      const isMii2026 = /\|2026\./.test(normalizedProfileUrl) || normalizedProfileUrl.includes('/2026/');

      // Detect specific MII module from URL
      if (isMii2026 && (
        normalizedProfileUrl.includes('/modul-person/') ||
        normalizedProfileUrl.includes('/modul-diagnose/') ||
        normalizedProfileUrl.includes('/modul-prozedur/') ||
        normalizedProfileUrl.includes('/modul-fall/')
      )) {
        return 'de.medizininformatikinitiative.kerndatensatz.base';
      }
      if (normalizedProfileUrl.includes('/modul-person/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.person';
      }
      if (normalizedProfileUrl.includes('/modul-labor/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.laborbefund';
      }
      if (normalizedProfileUrl.includes('/modul-diagnose/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.diagnose';
      }
      if (normalizedProfileUrl.includes('/modul-prozedur/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.prozedur';
      }
      if (normalizedProfileUrl.includes('/modul-medikation/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.medikation';
      }
      if (normalizedProfileUrl.includes('/modul-consent/') || normalizedProfileUrl.includes('/consent/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.consent';
      }
      if (normalizedProfileUrl.includes('/modul-bildgebung/') || normalizedProfileUrl.includes('/bildgebung/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.bildgebung';
      }
      if (normalizedProfileUrl.includes('/modul-biobank/') || normalizedProfileUrl.includes('/biobank/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.biobank';
      }
      if (
        normalizedProfileUrl.includes('/modul-molgen/') ||
        normalizedProfileUrl.includes('/molgen/') ||
        normalizedProfileUrl.includes('molekulargenetisch')
      ) {
        return 'de.medizininformatikinitiative.kerndatensatz.molgen';
      }
      if (normalizedProfileUrl.includes('/modul-onkologie/') || normalizedProfileUrl.includes('/onkologie/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.onkologie';
      }
      if (normalizedProfileUrl.includes('/modul-patho/') || normalizedProfileUrl.includes('/patho/')) {
        return 'de.medizininformatikinitiative.kerndatensatz.patho';
      }
      if (
        normalizedProfileUrl.includes('/modul-icu/') ||
        normalizedProfileUrl.includes('/icu/') ||
        normalizedProfileUrl.includes('/intensivmedizin/')
      ) {
        return 'de.medizininformatikinitiative.kerndatensatz.icu';
      }

      return isMii2026
        ? 'de.medizininformatikinitiative.kerndatensatz.base'
        : 'de.medizininformatikinitiative.kerndatensatz.person';
    }

    // KBV: https://fhir.kbv.de/StructureDefinition/...
    if (profileUrl.includes('fhir.kbv.de')) {
      return 'kbv.basis';
    }

    // Australian Base: http://hl7.org.au/fhir/StructureDefinition/...
    if (profileUrl.includes('hl7.org.au')) {
      return 'hl7.fhir.au.base';
    }

    // Canadian Baseline: http://hl7.org/fhir/ca/baseline/StructureDefinition/...
    if (profileUrl.includes('hl7.org/fhir/ca')) {
      return 'hl7.fhir.ca.baseline';
    }

    // WHO ANC-CDS: http://fhir.org/guides/who/anc-cds/StructureDefinition/...
    if (profileUrl.includes('fhir.org/guides/who/anc-cds') || profileUrl.includes('who.anc-cds')) {
      logger.info(`[PackageRegistry] Detected WHO ANC-CDS profile: ${profileUrl}`);
      return 'who.fhir.anc-cds';
    }

    // ========================================================================
    // Generic discovery: Use ProfilePackageMapper for unknown packages
    // ========================================================================

    logger.info(`[PackageRegistry] Unknown profile URL, using generic discovery: ${profileUrl}`);

    try {
      // Use the embedder's package-mapping fallback (server wires the
      // DB-backed ProfilePackageMapper here; standalone callers skip).
      const { getProfileSource } = await import('../persistence');
      const find = getProfileSource().findPackageForProfile;
      if (find) {
        const packageInfo = await find(profileUrl);
        if (packageInfo) {
          logger.info(`[PackageRegistry] ✓ Generic discovery found: ${packageInfo.packageId} (confidence: ${packageInfo.confidenceScore ?? 'n/a'})`);
          return packageInfo.packageId;
        }
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[PackageRegistry] Generic discovery failed:`, err.message);
    }

    logger.warn(`[PackageRegistry] Could not detect package for profile: ${profileUrl}`);
    return null;
  }

  /**
   * Get latest version from manifest (fallback if dist-tags.latest is missing)
   */
  private getLatestVersion(manifest: PackageManifest): string | null {
    const versions = Object.keys(manifest.versions);
    if (versions.length === 0) {
      return null;
    }

    // Sort versions semantically (simple heuristic)
    versions.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aNum = aParts[i] || 0;
        const bNum = bParts[i] || 0;
        if (aNum !== bNum) {
          return bNum - aNum; // Descending
        }
      }
      return 0;
    });

    return versions[0];
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[PackageRegistry] Cache cleared');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const packageRegistryClient = new PackageRegistryClient();
