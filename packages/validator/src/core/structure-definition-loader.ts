/** Loads and caches FHIR StructureDefinitions from bundled, local, and remote sources. */

import type { StructureDefinition } from './structure-definition-types.js';
import type { ProfileSourcesConfig, ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { captureValidationDependency } from '../validation-dependency-snapshot.js';
import { loadIGPackageIntoAvailableProfiles } from './sd-loader-ig-package.js';
import { cacheLoadedIGPackage } from './sd-loader-ig-package-cache.js';
import { loadProfilesBatchWithCache } from './sd-loader-batch-loader.js';
import { getCachedBaseResourceType } from './sd-loader-base-resource-type.js';
import { clearExternalProfiles, storeExternalProfile } from './sd-loader-external-profile-cache.js';
import type { PinnedCanonicalFingerprint } from './sd-loader-pinned-canonical.js';
import {
  StructureDefinitionLoaderRuntime,
  type StructureDefinitionLoaderOptions,
} from './sd-loader-runtime.js';
export { normalizeKnownStructureDefinitionCanonicalUrl } from './sd-loader-version-utils.js';

export type { Binding, Constraint, ElementDefinition, ElementType, StructureDefinition } from './structure-definition-types.js';

export class StructureDefinitionLoader {
  private readonly runtime: StructureDefinitionLoaderRuntime;
  private profileSourceContext?: ProfileSourceContext;
  private profileResolutionSettings?: ValidationSettings;

  constructor(
    cachePath: string,
    bundledPath?: string | null,
    options?: StructureDefinitionLoaderOptions,
  ) {
    this.runtime = new StructureDefinitionLoaderRuntime(cachePath, bundledPath, options);
  }

  async waitForInitialization(): Promise<void> {
    await this.runtime.waitForInitialization();
  }

  /** Package store directories this loader resolves profiles from. */
  getPackageSources(): string[] {
    return [...this.runtime.packageSources];
  }

  /** Pin unversioned canonical URLs before cache lookup. */
  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.runtime.policy.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.runtime.policy.getPinnedCanonicalCount();
  }

  getPinnedCanonicalFingerprint(): PinnedCanonicalFingerprint {
    return this.runtime.policy.getPinnedCanonicalFingerprint();
  }

  /**
   * Load multiple StructureDefinitions in batch (optimized)
   * This is 3-5x faster than calling loadProfile() repeatedly
   */
  async loadProfilesBatch(
    urls: string[],
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<Map<string, StructureDefinition>> {
    if (this.profileSourceContext?.organizationId !== undefined) {
      const scopedProfiles = new Map<string, StructureDefinition>();
      await Promise.all(urls.map(async url => {
        const profile = await this.loadProfile(url, fhirVersion);
        if (profile) scopedProfiles.set(url, profile);
      }));
      return scopedProfiles;
    }
    const profiles = await loadProfilesBatchWithCache({
      urls,
      fhirVersion,
      cache: this.runtime.cache,
      resolvePinnedCanonical: url => this.runtime.policy.resolvePinnedCanonical(url),
      loadProfile: (url, version) => this.loadProfile(url, version),
    });
    this.runtime.pruneProfileCache();
    return profiles;
  }

  /**
   * Bind subsequent profile loads to the current validation request. Scoped
   * validator instances make this stable for the duration of a tenant run.
   */
  setProfileResolutionContext(
    context?: ProfileSourceContext,
    settings?: ValidationSettings,
  ): void {
    this.profileSourceContext = context;
    this.profileResolutionSettings = settings;
  }

  getProfileResolutionContext(): ProfileSourceContext | undefined {
    return this.profileSourceContext
      ? { ...this.profileSourceContext }
      : undefined;
  }

  loadProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<StructureDefinition | null> {
    return captureValidationDependency('profile', 'load-profile',
      [url, fhirVersion, this.profileSourceContext, this.profileResolutionSettings], () => this.runtime.loadProfile(
      url,
      fhirVersion,
      this.profileSourceContext,
      this.profileResolutionSettings,
    ));
  }

  async hasBaseProfiles(): Promise<boolean> {
    return this.runtime.hasBaseProfiles();
  }

  /**
   * Synchronously resolve a profile canonical URL to its base FHIR resource type
   * (e.g. "http://fhir.de/StructureDefinition/ISiKPatient" → "Patient").
   * Returns null if the profile is not in the in-memory cache.
   */
  getBaseResourceType(canonicalUrl: string): string | null {
    return getCachedBaseResourceType(this.runtime.cache, canonicalUrl);
  }

  isProfileAvailable(url: string): boolean {
    return this.runtime.availableProfiles.has(url) || this.runtime.cache.has(url);
  }

  getAvailableProfiles(): string[] {
    return Array.from(this.runtime.availableProfiles);
  }

  async loadIGPackage(packageId: string, version?: string): Promise<void> {
    await this.waitForInitialization();
    const loaded = await loadIGPackageIntoAvailableProfiles(
      this.runtime.cachePath,
      this.runtime.availableProfiles,
      packageId,
      version,
    );
    if (!loaded) return;
    if (loaded.version) {
      this.setPackageVersionPins({
        ...this.runtime.policy.packagePins,
        [loaded.packageId]: loaded.version,
      });
    }
    cacheLoadedIGPackage({
      loaded,
      cache: this.runtime.cache,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
    this.runtime.pruneProfileCache();
  }

  setAutoDownload(enabled: boolean): void {
    this.runtime.policy.setAutoDownload(enabled);
  }

  /**
   * Update which remote sources are allowed for profile resolution.
   */
  setProfileSourcesConfig(config: ProfileSourcesConfig): void {
    this.runtime.policy.setProfileSourcesConfig(config);
  }

  getProfileSourcesConfig(): ProfileSourcesConfig {
    return this.runtime.policy.getProfileSourcesConfig();
  }

  isAutoDownloadEnabled(): boolean {
    return this.runtime.policy.autoDownloadEnabled;
  }

  setAllowedPackages(packages: string[]): void {
    this.runtime.policy.setAllowedPackages(packages);
  }

  getAllowedPackages(): string[] {
    return this.runtime.policy.getAllowedPackages();
  }

  /**
   * Pin package versions used by auto-download.
   */
  setPackageVersionPins(pins: Record<string, string>): void {
    this.runtime.policy.setPackageVersionPins(pins);
  }

  getPackageVersionPins(): Record<string, string> {
    return this.runtime.policy.getPackageVersionPins();
  }

  setSelectedCorePackage(packageId: string | undefined): void {
    this.runtime.policy.setSelectedCorePackage(packageId);
  }

  getSelectedCorePackage(): string | undefined {
    return this.runtime.policy.selectedCorePackage;
  }

  cacheProfile(url: string, profile: StructureDefinition, fhirVersion?: 'R4' | 'R5' | 'R6'): void {
    storeExternalProfile({
      url, profile, fhirVersion,
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
  }

  registerExternalProfile(
    sd: StructureDefinition,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): boolean {
    return storeExternalProfile({
      url: sd?.url, profile: sd, fhirVersion,
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
  }

  /** Drop externally registered profiles only. Returns how many were removed. */
  clearExternalProfiles(): number {
    return clearExternalProfiles({
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
  }

  clearCache(): void {
    this.runtime.clearCache();
  }

}
