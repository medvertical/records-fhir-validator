/**
 * StructureDefinition Loader
 * 
 * Loads and caches FHIR StructureDefinitions from various sources:
 * - Local package cache
 * - Bundled base profiles
 * - Remote sources (packages.fhir.org, Simplifier)
 */

import { promises as fs } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PackageDownloader, packageDownloader } from '../package/package-downloader.js';
import { PackageRegistryClient, packageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger';
import type { StructureDefinition } from './structure-definition-types';
import type { ProfileSourcesConfig } from '../types';
import { scanCacheDirectory, scanPackageDirectory } from './sd-loader-package-scanner';
import { loadFromLocalCache, isRelevantPackage as _isRelevantPackage } from './sd-loader-filesystem';
import { parseAllowedPackages, isPackageAllowed as _isPackageAllowed } from './sd-loader-package-config';
import { checkDatabaseCache } from './sd-loader-db-cache';
import { attemptAutoDownload, isPublicProfile } from './sd-loader-auto-download';
import { getProfileSource } from '../persistence';

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
    this.bundledPath = bundledPath ?? this.getDefaultBundledPath();
    this.autoDownload = options?.autoDownload ?? (process.env.FHIR_AUTO_DOWNLOAD_PACKAGES === 'true');
    this.profileSourcesConfig = options?.profileSourcesConfig ?? {
      fhirServer: true,
      simplifier: true,
      packageRegistry: true
    };
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
   * Resolve the bundled-profiles directory.
   *
   * The bundled FHIR-package directory ships in a separate workspace
   * package, `@records-fhir/bundled-profiles`, declared as an optional
   * peer dep. Splitting it out keeps the validator's tarball small for
   * consumers who only validate against online tx servers.
   *
   * Resolution order:
   *   1. `FHIR_BUNDLED_PROFILES_PATH` env var (operator override).
   *      `RECORDS_BUNDLED_PROFILES_PATH` is honored as a deprecated alias
   *      for the 0.1.x line and will be removed in 0.2.
   *   2. `@records-fhir/bundled-profiles` resolved via npm — works inside
   *      the monorepo via the workspace symlink, and from a normal
   *      `npm install` if the consumer opted in to the peer dep.
   *
   * Returns `null` when neither resolves; callers fall back to download
   * from packages.fhir.org / Simplifier or fail loudly depending on
   * settings. Constructor `bundledPath` arg overrides this default.
   */
  private getDefaultBundledPath(): string | null {
    const fromEnv =
      process.env.FHIR_BUNDLED_PROFILES_PATH ?? process.env.RECORDS_BUNDLED_PROFILES_PATH;
    if (fromEnv) {
      if (process.env.RECORDS_BUNDLED_PROFILES_PATH && !process.env.FHIR_BUNDLED_PROFILES_PATH) {
        logger.warn(
          '[SDLoader] RECORDS_BUNDLED_PROFILES_PATH is deprecated; rename to FHIR_BUNDLED_PROFILES_PATH (will be removed in 0.2.x).',
        );
      }
      return fromEnv;
    }

    try {
      const require = createRequire(import.meta.url);
      const pkgEntry = require.resolve('@records-fhir/bundled-profiles');
      return path.resolve(path.dirname(pkgEntry), 'storage', 'profiles', 'bundled');
    } catch {
      return null;
    }
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
      let sourcesFound = 0;

      // Scan all package sources in priority order
      for (const source of this.packageSources) {
        try {
          await fs.access(source);
          logger.info(`[SDLoader] Scanning package source: ${source}`);
          await scanCacheDirectory(source, this.availableProfiles, {
            packageVersionPins: this.packageVersionPins
          });
          sourcesFound++;
        } catch {
          logger.debug(`[SDLoader] Package source not found: ${source}`);
        }
      }

      if (sourcesFound === 0) {
        logger.warn('[SDLoader] No package sources found! Validator will have limited functionality.');
      }

      // 🔥 Warm-up: Pre-load profiles from database cache
      await this.warmUpFromDatabase();

      const elapsed = Date.now() - startTime;
      logger.info(`[SDLoader] ✅ Initialization complete in ${elapsed}ms (bundled: ${this.availableProfiles.size}, cached: ${this.cache.size})`);

      // Mark initialization as complete
      this.initializationComplete = true;

    } catch (error) {
      logger.warn('[SDLoader] Error initializing cache:', error);
    }
  }

  /**
   * Warm-up: Pre-load profiles from database cache
   * This eliminates cold-start penalty for frequently used profiles
   */
  private async warmUpFromDatabase(): Promise<void> {
    const source = getProfileSource();
    if (!source.loadAllForWarmup) {
      // No embedder-provided bulk-load implementation; skip silently.
      // Standalone CLI / npm-package callers hit this path and that's fine.
      return;
    }

    try {
      logger.info('[SDLoader] 🔥 Starting ProfileSource warm-up...');
      const warmupStart = Date.now();

      const loadedProfiles = await source.loadAllForWarmup();

      // Transfer loaded profiles to SDLoader caches
      for (const [, result] of loadedProfiles.entries()) {
        if (result.profile) {
          const sanitized = this.sanitizeProfile(result.profile);
          this.cache.set(result.canonicalUrl, sanitized);
          this.availableProfiles.add(result.canonicalUrl);
        }
      }

      const warmupTime = Date.now() - warmupStart;
      logger.info(`[SDLoader] 🔥 Warm-up complete: ${loadedProfiles.size} profiles loaded in ${warmupTime}ms`);

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      // Don't fail initialization if warm-up fails
      logger.warn(`[SDLoader] ProfileSource warm-up failed (non-critical): ${err.message}`);
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
    const startTime = Date.now();
    const results = new Map<string, StructureDefinition>();

    logger.info(`[SDLoader] Batch loading ${urls.length} profile(s)`);

    try {
      // Step 1: Deduplicate URLs
      const uniqueUrls = Array.from(new Set(urls));
      logger.debug(`[SDLoader] Deduplicated: ${urls.length} → ${uniqueUrls.length} unique URLs`);

      // Step 2: Check in-memory cache for all profiles
      const uncachedUrls: string[] = [];
      for (const url of uniqueUrls) {
        if (this.cache.has(url)) {
          results.set(url, this.cache.get(url)!);
        } else {
          uncachedUrls.push(url);
        }
      }
      logger.info(`[SDLoader] Cache hits: ${results.size}/${uniqueUrls.length}, need to load: ${uncachedUrls.length}`);

      // Step 3: Load uncached profiles in parallel with timeout
      if (uncachedUrls.length > 0) {
        const loadPromises = uncachedUrls.map(async (url) => {
          try {
            // Wrap each loadProfile call with a 30s timeout
            const sd = await Promise.race([
              this.loadProfile(url, fhirVersion),
              new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error(`Profile load timeout after 30s: ${url}`)), 30000)
              )
            ]);
            if (sd) {
              results.set(url, sd);
            }
          } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[SDLoader] Failed to load profile ${url}:`, err.message || error);
          }
        });

        await Promise.all(loadPromises);
      }

      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / urls.length;
      logger.info(
        `[SDLoader] Batch load complete in ${totalTime}ms ` +
        `(avg ${avgTime.toFixed(2)}ms/profile, ${results.size}/${uniqueUrls.length} loaded)`
      );

      return results;

    } catch (error) {
      logger.error('[SDLoader] Batch load error:', error);
      return results; // Return partial results
    }
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
      let _skipFilesystemCache = true;

      // Canonical pinning: if the URL is unversioned and we have a pinned
      // resolution, redirect to the versioned form. This makes runtime
      // resolution deterministic regardless of which packages are loaded.
      let resolvedUrl = url;
      if (this.pinnedCanonicals && !url.includes('|')) {
        const pinned = this.pinnedCanonicals.get(url);
        if (pinned) {
          resolvedUrl = pinned;
          logger.debug(`[SDLoader] Pinned: ${url} → ${pinned}`);
        }
      }

      // Use version-specific cache key to avoid R4/R5 confusion
      const cacheKey = `${resolvedUrl}:${fhirVersion}`;

      // Check in-memory cache first (version-specific)
      if (this.cache.has(cacheKey)) {
        logger.debug(`[SDLoader] Loading from in-memory cache: ${cacheKey}`);
        return this.cache.get(cacheKey)!;
      }

      // Check database cache (from ProfileResolver downloads)
      const dbCachedProfile = await checkDatabaseCache(url, this.dbCacheNotFound, fhirVersion);
      if (dbCachedProfile) {
        // Cache it in memory with version-specific key
        const sanitized = this.sanitizeProfile(dbCachedProfile);
        this.cache.set(cacheKey, sanitized);
        this.availableProfiles.add(url);
        return sanitized;
      }

      // If profile was not found in DB cache, skip filesystem check
      // (DB is the source of truth for downloaded profiles)
      if (this.dbCacheNotFound.has(url)) {
        _skipFilesystemCache = true;
        logger.debug(`[SDLoader] Skipping filesystem check for ${url} (in negative cache)`);
      }

      // Skip scanning for private profiles UNLESS they're in availableProfiles
      const isInBundledProfiles = this.availableProfiles.has(url);
      const publicProfile = isPublicProfile(url);

      if (!publicProfile && !isInBundledProfiles) {
        logger.debug(`[SDLoader] Skipping filesystem/auto-download for private/custom profile: ${url}`);
        return null;
      }

      if (!publicProfile && isInBundledProfiles) {
        logger.debug(`[SDLoader] Profile ${url} is in bundled packages, attempting to load from filesystem`);
      }

      // OPTIMIZATION: Filesystem scanning disabled entirely
      // Filesystem scans are too slow (30s+ for 36 packages with 1000+ profiles)
      // DB cache (2ms) + auto-download (20s timeout) is much faster
      logger.debug(`[SDLoader] Skipped filesystem cache for ${url} (filesystem scanning disabled)`);
      let sd = null;

      // If profile URL was found during scan, load it from filesystem
      if (this.availableProfiles.has(url)) {
        logger.debug(`[SDLoader] Profile found in availableProfiles, loading from filesystem: ${url}`);
        sd = await loadFromLocalCache(url, this.packageSources, fhirVersion);

        if (sd) {
          const sanitized = this.sanitizeProfile(sd);
          this.cache.set(cacheKey, sanitized);
          return sanitized;
        } else {
          logger.warn(`[SDLoader] Profile in availableProfiles but failed to load: ${url}`);
        }
      }

      // Auto-download if enabled
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
          fhirVersion: fhirVersion
        });

        if (downloadedProfile) {
          // Note: attemptAutoDownload does not cache in this.cache directly? 
          // Actually we assume it might but we should ensure we return sanitized version.
          // If we cache it, we should sanitize first.
          // Let's sanitize the return value only, since cache logic inside autoDownload is opaque here?
          // Actually attemptAutoDownload takes `cache` as arg.
          // We can't easily intercept the internal caching there unless we modify auto-download.ts
          // BUT since we pass `this.cache` to it, it likely populates it.
          // We SHOULD ensure `attemptAutoDownload` sanitizes OR we sanitize before use.
          // If it populates cache autonomously, we might have dirty cache.
          // However, we return the downloaded profile here.
          // We can update the cache with sanitized version if we want.
          const sanitized = this.sanitizeProfile(downloadedProfile);
          this.cache.set(cacheKey, sanitized); // Force update cache with sanitized version
          return sanitized;
        }
      }

      logger.warn(`[SDLoader] Profile not found: ${url}`);
      logger.debug(`[SDLoader] Auto-download was ${this.autoDownload ? 'enabled' : 'disabled'}`);
      return null;

    } catch (error: unknown) {
      logger.error(`[SDLoader] Error loading profile ${url}:`, error);
      return null;
    }
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
    try {
      logger.info(`[SDLoader] Loading IG package: ${packageId}@${version || 'latest'}`);

      const packagePath = path.join(this.cachePath, packageId);

      // Check if package exists
      try {
        await fs.access(packagePath);
      } catch {
        logger.warn(`[SDLoader] Package not found: ${packageId}`);
        return;
      }

      // Scan package directory
      await scanPackageDirectory(packagePath, this.availableProfiles);

      logger.info(`[SDLoader] Loaded IG package: ${packageId}`);

    } catch (error) {
      logger.error(`[SDLoader] Error loading IG package ${packageId}:`, error);
    }
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
    this.profileSourcesConfig = config;
    logger.info(
      `[SDLoader] Profile sources updated: ` +
      `FHIR=${config.fhirServer}, Simplifier=${config.simplifier}, Registry=${config.packageRegistry}`
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
  cacheProfile(url: string, profile: StructureDefinition): void {
    if (!profile || !url) return;

    this.cache.set(url, profile);
    this.availableProfiles.add(url);
    logger.debug(`[SDLoader] Externally cached profile: ${url}`);
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

    const sanitized = this.sanitizeProfile(sd);
    const cacheKey = `${sd.url}:${fhirVersion}`;

    this.cache.set(cacheKey, sanitized);
    this.availableProfiles.add(sd.url);
    // Clear any prior "not-found" marker so subsequent lookups hit the cache
    this.dbCacheNotFound.delete(sd.url);

    logger.debug(`[SDLoader] Registered external profile: ${sd.url} (${fhirVersion})`);
    return true;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[SDLoader] Cache cleared');
  }

  /**
   * Sanitize profile logic to fix known bugs in definitions
   * e.g., bad FHIRPath expressions in US Core
   */
  private sanitizeProfile(sd: StructureDefinition): StructureDefinition {
    if (!sd || !sd.snapshot || !sd.snapshot.element) return sd;

    let patched = false;
    for (const element of sd.snapshot.element) {
      if (element.constraint) {
        for (const constraint of element.constraint) {
          // Fix pd-1: "telecom or endpoint" -> "telecom.exists() or endpoint.exists()"
          // This causes "expected singleton of type Boolean" error in fhirpath.js because collections (0..*) are not booleans
          if (constraint.expression && constraint.key === 'pd-1' && constraint.expression.includes('telecom or endpoint') && !constraint.expression.includes('exists()')) {
            constraint.expression = 'telecom.exists() or endpoint.exists()';
            patched = true;
          }
        }
      }
    }

    if (patched) {
      logger.debug(`[SDLoader] Patched constraints in profile: ${sd.url}`);
    }

    return sd;
  }
}
