/**
 * StructureDefinition Loader
 * 
 * Loads and caches FHIR StructureDefinitions from various sources:
 * - Local package cache
 * - Bundled base profiles
 * - Remote sources (packages.fhir.org, Simplifier)
 */

import { PackageDownloader, packageDownloader } from '../package/package-downloader.js';
import { PackageRegistryClient, packageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger';
import type { StructureDefinition } from './structure-definition-types';
import type { ProfileSourcesConfig } from '../types';
import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import { loadFromLocalCache, isRelevantPackage as _isRelevantPackage } from './sd-loader-filesystem';
import { parseAllowedPackages, isPackageAllowed as _isPackageAllowed } from './sd-loader-package-config';
import { checkDatabaseCache } from './sd-loader-db-cache';
import { attemptAutoDownload, isPublicProfile } from './sd-loader-auto-download';
import {
  cacheKeyForProfile,
  fhirVersionFamily,
  urlMatchesRequestedFhirVersion,
} from './sd-loader-version-utils';
import { resolveDefaultBundledProfilesPath } from './sd-loader-bundled-path';
import { sanitizeProfile } from './sd-loader-profile-sanitizer';
import { loadIGPackageIntoAvailableProfiles } from './sd-loader-ig-package';
import { loadProfilesBatchWithCache } from './sd-loader-batch-loader';
import { scanProfileSources, warmUpProfilesFromDatabase } from './sd-loader-initialization';

// Re-export types from separate file to break circular dependencies
export type {
  StructureDefinition,
  ElementDefinition,
  ElementType,
  Constraint,
  Binding
} from './structure-definition-types';

// ============================================================================
// StructureDefinition Loader
// ============================================================================

export class StructureDefinitionLoader {
  private cachePath: string;
  private bundledPath: string | null;
  private cache: Map<string, StructureDefinition> = new Map();
  private availableProfiles: Set<string> = new Set();
  private packageSources: string[] = [];
  private packageDownloader: PackageDownloader;
  private registryClient: PackageRegistryClient;
  private autoDownload: boolean;
  private profileSourcesConfig: ProfileSourcesConfig;
  private allowedPackages: string[];
  private packageVersionPins: Record<string, string>;
  private initializationPromise: Promise<void>;
  private dbCacheNotFound: Set<string> = new Set(); // Negative cache for DB lookups
  private profileNotFound: Set<string> = new Set(); // Negative cache for full loadProfile misses
  private profileLoadPromises = new Map<string, Promise<StructureDefinition | null>>();
  private initializationComplete: boolean = false; // Guard against re-initialization
  private pinnedCanonicals: Map<string, string> | null = null; // url → url|version

  constructor(
    cachePath: string,
    bundledPath?: string | null,
    options?: {
      autoDownload?: boolean;
      profileSourcesConfig?: ProfileSourcesConfig;
      allowedPackages?: string[];
      packageVersionPins?: Record<string, string>;
      packageDownloader?: PackageDownloader;
      registryClient?: PackageRegistryClient;
    }
  ) {
    this.cachePath = cachePath;
    this.bundledPath = bundledPath ?? resolveDefaultBundledProfilesPath();
    this.autoDownload = options?.autoDownload ?? (process.env.FHIR_AUTO_DOWNLOAD_PACKAGES === 'true');
    this.profileSourcesConfig = normalizeProfileSourcesConfig(options?.profileSourcesConfig);
    this.allowedPackages = options?.allowedPackages ?? parseAllowedPackages();
    this.packageVersionPins = { ...(options?.packageVersionPins ?? {}) };
    this.packageDownloader = options?.packageDownloader ?? packageDownloader;
    this.registryClient = options?.registryClient ?? packageRegistryClient;

    // Priority order for package sources:
    // 1. Bundled profiles (shipped with app) - highest priority. Skipped
    //    when @records-fhir/bundled-profiles isn't installed and no env
    //    override is set, so the engine still works online-only.
    // 2. User cache (downloaded by HAPI or other tools)
    this.packageSources = [
      ...(this.bundledPath ? [this.bundledPath] : []),
      this.cachePath
    ];

    logger.info(`[SDLoader] Package sources: ${this.packageSources.join(', ')}`);
    logger.info(`[SDLoader] Auto-download: ${this.autoDownload ? 'enabled' : 'disabled'}`);
    if (this.autoDownload) {
      logger.debug(`[SDLoader] Allowed packages: ${this.allowedPackages.join(', ')}`);
    }

    // Start initialization but don't block constructor
    this.initializationPromise = this.initializeCache();
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  /**
   * Set pinned canonical map from the package resolver. When set,
   * loadProfile() resolves unversioned URLs to their pinned version
   * before looking up caches, eliminating runtime ambiguity.
   */
  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.pinnedCanonicals = pinned;
    logger.info(`[SDLoader] Pinned ${pinned.size} canonical(s) — runtime resolution is now deterministic`);
  }

  /**
   * Get pinned canonical count for evidence reports.
   */
  getPinnedCanonicalCount(): number {
    return this.pinnedCanonicals?.size ?? 0;
  }

  /**
   * Initialize cache with available profiles from all sources
   */
  private async initializeCache(): Promise<void> {
    // Guard against re-initialization
    if (this.initializationComplete) {
      logger.debug('[SDLoader] Already initialized, skipping');
      return;
    }

    const startTime = Date.now();

    try {
      await scanProfileSources({
        packageSources: this.packageSources,
        availableProfiles: this.availableProfiles,
        packageVersionPins: this.packageVersionPins,
      });

      await warmUpProfilesFromDatabase({
        cache: this.cache,
        availableProfiles: this.availableProfiles,
      });

      const elapsed = Date.now() - startTime;
      logger.info(`[SDLoader] ✅ Initialization complete in ${elapsed}ms (bundled: ${this.availableProfiles.size}, cached: ${this.cache.size})`);

      // Mark initialization as complete
      this.initializationComplete = true;

    } catch (error) {
      logger.warn('[SDLoader] Error initializing cache:', error);
    }
  }

  // Package scanning methods extracted to sd-loader-package-scanner.ts

  /**
   * Load multiple StructureDefinitions in batch (optimized)
   * This is 3-5x faster than calling loadProfile() repeatedly
   * 
   * @param urls - Array of profile URLs to load
   * @param fhirVersion - FHIR version
   * @returns Map of URL to StructureDefinition (missing profiles will not be in map)
   */
  async loadProfilesBatch(
    urls: string[],
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<Map<string, StructureDefinition>> {
    return loadProfilesBatchWithCache({
      urls,
      fhirVersion,
      cache: this.cache,
      resolvePinnedCanonical: url => this.resolvePinnedCanonical(url),
      loadProfile: (url, version) => this.loadProfile(url, version),
    });
  }

  /**
   * Load a StructureDefinition by URL
   */
  async loadProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<StructureDefinition | null> {
    try {
      // OPTIMIZATION: Skip filesystem scanning entirely - rely on DB cache + auto-download
      // Filesystem scans are extremely slow (30s for 36 packages with 1000+ profiles)
      // DB cache is fast (2ms) and auto-download handles missing profiles (20s timeout)
      // Canonical pinning: if the URL is unversioned and we have a pinned
      // resolution, redirect to the versioned form. This makes runtime
      // resolution deterministic regardless of which packages are loaded.
      const resolvedUrl = this.resolvePinnedCanonical(url);

      // Use version-specific cache key to avoid R4/R5 confusion
      const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);

      if (this.profileNotFound.has(cacheKey)) {
        logger.debug(`[SDLoader] Skipping profile load for ${cacheKey} (known not found)`);
        return null;
      }

      if (!urlMatchesRequestedFhirVersion(resolvedUrl, fhirVersion)) {
        logger.debug(`[SDLoader] Skipping FHIR-version-incompatible profile URL: ${resolvedUrl} (${fhirVersion})`);
        this.profileNotFound.add(cacheKey);
        return null;
      }

      // Check in-memory cache first (version-specific)
      if (this.cache.has(cacheKey)) {
        logger.debug(`[SDLoader] Loading from in-memory cache: ${cacheKey}`);
        return this.cache.get(cacheKey)!;
      }

      // Check database cache (from ProfileResolver downloads)
      const dbCachedProfile = await checkDatabaseCache(url, this.dbCacheNotFound, fhirVersion);
      if (dbCachedProfile) {
        // Cache it in memory with version-specific key
        const sanitized = sanitizeProfile(dbCachedProfile);
        this.cache.set(cacheKey, sanitized);
        this.availableProfiles.add(url);
        this.profileNotFound.delete(cacheKey);
        return sanitized;
      }

      // If profile was not found in DB cache, skip filesystem check
      // (DB is the source of truth for downloaded profiles)
      if (this.dbCacheNotFound.has(url)) {
        logger.debug(`[SDLoader] Skipping filesystem check for ${url} (in negative cache)`);
      }

      // Skip scanning for private profiles UNLESS they're in availableProfiles
      const isInBundledProfiles = this.availableProfiles.has(url) || this.availableProfiles.has(resolvedUrl);
      const publicProfile = isPublicProfile(url);

      if (!publicProfile && !isInBundledProfiles) {
        logger.debug(`[SDLoader] Skipping filesystem/auto-download for private/custom profile: ${url}`);
        this.profileNotFound.add(cacheKey);
        return null;
      }

      if (!publicProfile && isInBundledProfiles) {
        logger.debug(`[SDLoader] Profile ${url} is in bundled packages, attempting to load from filesystem`);
      }

      // OPTIMIZATION: Filesystem scanning disabled entirely
      // Filesystem scans are too slow (30s+ for 36 packages with 1000+ profiles)
      // DB cache (2ms) + auto-download (20s timeout) is much faster
      logger.debug(`[SDLoader] Skipped filesystem cache for ${url} (filesystem scanning disabled)`);

      const existingLoad = this.profileLoadPromises.get(cacheKey);
      if (existingLoad) {
        return existingLoad;
      }

      const loadPromise = this.loadProfileFromKnownSources(url, resolvedUrl, cacheKey, fhirVersion).finally(() => {
        this.profileLoadPromises.delete(cacheKey);
      });

      this.profileLoadPromises.set(cacheKey, loadPromise);
      return loadPromise;

    } catch (error: unknown) {
      logger.error(`[SDLoader] Error loading profile ${url}:`, error);
      return null;
    }
  }

  private async loadProfileFromKnownSources(
    url: string,
    resolvedUrl: string,
    cacheKey: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<StructureDefinition | null> {
    if (this.availableProfiles.has(url) || this.availableProfiles.has(resolvedUrl)) {
      logger.debug(`[SDLoader] Profile found in availableProfiles, loading from filesystem: ${url}`);
      const sd = await loadFromLocalCache(resolvedUrl, this.packageSources, fhirVersion);

      if (sd) {
        const sanitized = sanitizeProfile(sd);
        this.cache.set(cacheKey, sanitized);
        this.profileNotFound.delete(cacheKey);
        return sanitized;
      }

      logger.warn(`[SDLoader] Profile in availableProfiles but failed to load: ${url}`);
      this.profileNotFound.add(cacheKey);
      return null;
    }

    if (this.autoDownload) {
      const downloadedProfile = await attemptAutoDownload(url, {
        registryClient: this.registryClient,
        packageDownloader: this.packageDownloader,
        allowedPackages: this.allowedPackages,
        packageVersionPins: this.packageVersionPins,
        packageSources: this.packageSources,
        cache: this.cache,
        availableProfiles: this.availableProfiles,
        profileSourcesConfig: this.profileSourcesConfig,
        fhirVersion,
      });

      if (downloadedProfile) {
        const sanitized = sanitizeProfile(downloadedProfile);
        this.cache.set(cacheKey, sanitized);
        this.profileNotFound.delete(cacheKey);
        return sanitized;
      }

      logger.warn(`[SDLoader] Profile not found: ${url}`);
      logger.debug('[SDLoader] Auto-download was enabled');
      this.profileNotFound.add(cacheKey);
      return null;
    }

    logger.warn(`[SDLoader] Profile not found: ${url}`);
    logger.debug('[SDLoader] Auto-download was disabled');
    this.profileNotFound.add(cacheKey);
    return null;
  }

  // Filesystem loading methods extracted to sd-loader-filesystem.ts

  /**
   * Check if base profiles are available
   */
  async hasBaseProfiles(): Promise<boolean> {
    // Check for common base profiles
    const baseProfiles = [
      'http://hl7.org/fhir/StructureDefinition/Patient',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    ];

    for (const profileUrl of baseProfiles) {
      if (this.availableProfiles.has(profileUrl)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Synchronously resolve a profile canonical URL to its base FHIR resource type
   * (e.g. "http://fhir.de/StructureDefinition/ISiKPatient" → "Patient").
   * Returns null if the profile is not in the in-memory cache.
   */
  getBaseResourceType(canonicalUrl: string): string | null {
    // Try version-specific keys first (R4, R5), then bare URL
    for (const suffix of [':R4', ':R5', '']) {
      const sd = this.cache.get(canonicalUrl + suffix);
      if (sd?.type) return sd.type;
    }
    return null;
  }

  /**
   * Check if a specific profile is available
   */
  isProfileAvailable(url: string): boolean {
    return this.availableProfiles.has(url) || this.cache.has(url);
  }

  /**
   * Get list of all available profiles
   */
  getAvailableProfiles(): string[] {
    return Array.from(this.availableProfiles);
  }

  /**
   * Load an entire IG package
   */
  async loadIGPackage(
    packageId: string,
    version?: string
  ): Promise<void> {
    return loadIGPackageIntoAvailableProfiles(this.cachePath, this.availableProfiles, packageId, version);
  }

  // Package configuration methods extracted to sd-loader-package-config.ts

  /**
   * Enable or disable auto-download
   */
  setAutoDownload(enabled: boolean): void {
    this.autoDownload = enabled;
    logger.info(`[SDLoader] Auto-download ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update which remote sources are allowed for profile resolution.
   */
  setProfileSourcesConfig(config: ProfileSourcesConfig): void {
    this.profileSourcesConfig = normalizeProfileSourcesConfig(config);
    logger.info(
      `[SDLoader] Profile sources updated: ` +
      `Simplifier=${this.profileSourcesConfig.simplifier}, Registry=${this.profileSourcesConfig.packageRegistry}`
    );
  }

  /**
   * Get current remote profile source configuration.
   */
  getProfileSourcesConfig(): ProfileSourcesConfig {
    return { ...this.profileSourcesConfig };
  }

  /**
   * Get auto-download status
   */
  isAutoDownloadEnabled(): boolean {
    return this.autoDownload;
  }

  /**
   * Set allowed packages
   */
  setAllowedPackages(packages: string[]): void {
    this.allowedPackages = packages;
    logger.info(`[SDLoader] Allowed packages updated: ${packages.join(', ')}`);
  }

  /**
   * Get allowed packages
   */
  getAllowedPackages(): string[] {
    return [...this.allowedPackages];
  }

  /**
   * Pin package versions used by auto-download.
   */
  setPackageVersionPins(pins: Record<string, string>): void {
    this.packageVersionPins = { ...pins };
    logger.info(`[SDLoader] Package version pins updated: ${Object.keys(pins).length} package(s)`);
  }

  /**
   * Get package version pins used by auto-download.
   */
  getPackageVersionPins(): Record<string, string> {
    return { ...this.packageVersionPins };
  }

  /**
   * Cache a profile from external source (e.g., FHIR client)
   * This ensures profiles loaded from the FHIR server are reused in subsequent validation runs
   */
  cacheProfile(url: string, profile: StructureDefinition, fhirVersion?: 'R4' | 'R5' | 'R6'): void {
    if (!profile || !url) return;

    const family = fhirVersionFamily(profile) ?? fhirVersion ?? 'R4';
    const cacheKey = cacheKeyForProfile(url, family);
    this.cache.set(cacheKey, profile);
    this.availableProfiles.add(url);
    this.profileNotFound.delete(cacheKey);
    this.profileLoadPromises.delete(cacheKey);
    logger.debug(`[SDLoader] Externally cached profile: ${url} (${family})`);
  }

  private resolvePinnedCanonical(url: string): string {
    if (this.pinnedCanonicals && !url.includes('|')) {
      const pinned = this.pinnedCanonicals.get(url);
      if (pinned) {
        logger.debug(`[SDLoader] Pinned: ${url} → ${pinned}`);
        return pinned;
      }
    }
    return url;
  }

  /**
   * Register an external StructureDefinition with the loader.
   *
   * Unlike cacheProfile(), this method caches using the same version-specific
   * cache key format that loadProfile() uses (`${url}:${fhirVersion}`), so the
   * registered profile is actually discoverable by the main validation path.
   *
   * Used by:
   * - Conformance test harness (case-runner) to preload supporting profiles
   * - External callers that want to inject a profile without filesystem/download
   */
  registerExternalProfile(
    sd: StructureDefinition,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): boolean {
    if (!sd || !sd.url) {
      logger.warn('[SDLoader] registerExternalProfile: SD has no url, skipping');
      return false;
    }

    const sanitized = sanitizeProfile(sd);
    const cacheKey = `${sd.url}:${fhirVersion}`;

    this.cache.set(cacheKey, sanitized);
    this.availableProfiles.add(sd.url);
    // Clear any prior "not-found" marker so subsequent lookups hit the cache
    this.dbCacheNotFound.delete(sd.url);
    this.dbCacheNotFound.delete(cacheKey);
    this.profileNotFound.delete(cacheKey);
    this.profileLoadPromises.delete(cacheKey);

    logger.debug(`[SDLoader] Registered external profile: ${sd.url} (${fhirVersion})`);
    return true;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.profileNotFound.clear();
    this.profileLoadPromises.clear();
    logger.info('[SDLoader] Cache cleared');
  }

}
