import { isPinExemptCanonical } from '../package/canonical-pin-context.js';
/** Loads and caches FHIR StructureDefinitions from bundled, local, and remote sources. */

import { profileDefinitionSourceKey, ProfileReferenceUnavailableError, resolveProfileReferenceAuthority, rethrowProfileReferenceCaptureFailure, profileReferenceHasPackageAuthority, selectedProfileLookup } from './profile-reference-authority.js';
import { withProfileSourceSnapshot } from '../persistence/profile-source.js';
import { copyProfilePackageProvenance, lookupProfilePackageDirectory, lookupProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { isDeepStrictEqual } from 'node:util';
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
import { pinProfileReference, type ProfileReferenceSource } from './profile-reference-pins.js';
import { resolveProfileRequest } from './sd-loader-version-utils.js';
import { isTenantScopedProfileRequest } from './tenant-profile-source-resolution.js';
export { normalizeKnownStructureDefinitionCanonicalUrl } from './sd-loader-version-utils.js';

export type { Binding, Constraint, ElementDefinition, ElementType, StructureDefinition } from './structure-definition-types.js';
export type { ProfileReferenceSource } from './profile-reference-pins.js';

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
    if (isDeepStrictEqual(this.profileSourceContext, context)
      && isDeepStrictEqual(this.profileResolutionSettings, settings)) return;
    this.profileSourceContext = context && structuredClone(context);
    this.profileResolutionSettings = settings && structuredClone(settings);
    this.runtime.policy.invalidate(false);
  }

  getProfileResolutionContext(): ProfileSourceContext | undefined {
    return this.profileSourceContext
      ? { ...this.profileSourceContext }
      : undefined;
  }

  /** Private reuse identity; it does not attest package or host content. */
  getDependencyCaptureScope(): object {
    return this.runtime.getDependencyCaptureScope();
  }

  /** The current effective request, before any profile source or cache lookup. */
  resolveProfileUrl(url: string, fhirVersion: 'R4' | 'R5' | 'R6'): string | null {
    if (selectedProfileLookup(url, fhirVersion)) return url;
    return resolveProfileRequest(url, fhirVersion, canonical => this.runtime.policy.resolvePinnedCanonical(canonical));
  }

  loadProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<StructureDefinition | null> {
    const selected = selectedProfileLookup(url, fhirVersion);
    const captureScope = this.getDependencyCaptureScope();
    const context = this.profileSourceContext, settings = this.profileResolutionSettings;
    return captureValidationDependency('profile', 'load-profile',
      [url, fhirVersion, context, settings, selected?.key], () => selected ? Promise.resolve(selected.profile) : this.runtime.loadProfile(
      url,
      fhirVersion,
      context,
      settings,
    ), captureScope, () => this.getDependencyCaptureScope());
  }

  /**
   * Version an unversioned canonical that `source` references to the release
   * its package's dependencies declare, before it reaches any URL-keyed cache.
   * A tenant resolves profiles through its own source, which the installed
   * package graph says nothing about.
   */
  pinProfileReference(
    url: string,
    source: ProfileReferenceSource | null | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<string> {
    if (isTenantScopedProfileRequest(url, this.profileSourceContext)) return Promise.resolve(url);
    return pinProfileReference(url, source, {
      storeDirs: this.runtime.packageSources,
      packageVersionPins: this.runtime.policy.packagePins,
    }, fhirVersion, { reuseScope: this.getDependencyCaptureScope(), currentScope: () => this.getDependencyCaptureScope() });
  }

  /**
   * Load a canonical that `source` references, at its dependency-pinned
   * package. An unavailable dependency cannot be replaced by a global profile.
   */
  async loadReferencedProfile(
    url: string,
    source: ProfileReferenceSource | null | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<StructureDefinition | null> {
    const captureScope = this.getDependencyCaptureScope();
    const context = this.profileSourceContext && structuredClone(this.profileSourceContext);
    const settings = this.profileResolutionSettings && structuredClone(this.profileResolutionSettings);
    // Reference authority depends on issued package provenance and identity, not the referrer's full definition.
    const copiedSource = source && { url: source.url, version: source.version };
    copyProfilePackageProvenance(source, copiedSource);
    const scope = { storeDirs: [...this.runtime.packageSources], packageVersionPins: this.runtime.policy.getPackageVersionPins() };
    const inventoryEligible = !isTenantScopedProfileRequest(url, context) && profileReferenceHasPackageAuthority(url, copiedSource);
    const fallback = this.runtime.captureProfileResolver(context, settings, {
      refreshHostProfile: !isPinExemptCanonical(url.split('|')[0]), retainUnavailableFailures: true,
    });
    return captureValidationDependency('profile', 'load-referenced-profile',
      [url, fhirVersion, context, settings, copiedSource, copiedSource && lookupProfilePackageProvenance(copiedSource),
        copiedSource && lookupProfilePackageDirectory(copiedSource)], () => withProfileSourceSnapshot(async () => {
        const authority = isTenantScopedProfileRequest(url, context)
          ? { status: 'unscoped' as const } : await resolveProfileReferenceAuthority(url, copiedSource, scope, fhirVersion,
            { reuseScope: captureScope, currentScope: () => this.getDependencyCaptureScope() });
        if (authority.status === 'unavailable') throw new ProfileReferenceUnavailableError(authority.receipt);
        if (authority.status === 'selected') {
          if (captureScope === this.getDependencyCaptureScope()) {
            const profile = structuredClone(authority.profile); copyProfilePackageProvenance(authority.profile, profile);
            this.runtime.cache.set(`${profile.url}|${profile.version ?? 'unversioned'}:${fhirVersion}@${profileDefinitionSourceKey(profile)}`, profile);
            this.runtime.pruneProfileCache();
          }
          return authority.profile;
        }
        return fallback(url, fhirVersion);
       }), captureScope, () => this.getDependencyCaptureScope(), inventoryEligible)
      .catch(error => rethrowProfileReferenceCaptureFailure(error, url, copiedSource));
  }

  /**
   * The canonical `loadReferencedProfile` would load, for a caller that hands
   * the reference on rather than the profile: the dependency-pinned release
   * when it loads, the unversioned canonical otherwise.
   */
  async referencedProfileUrl(
    url: string,
    source: ProfileReferenceSource | null | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<string> {
    const profile = await this.loadReferencedProfile(url, source, fhirVersion);
    return profile?.version && !url.includes('|') ? `${url}|${profile.version}` : url;
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
    for (const family of ['R4', 'R5', 'R6'] as const) {
      const selected = selectedProfileLookup(canonicalUrl, family);
      if (selected?.profile.type) return selected.profile.type;
    }
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
    const stored = storeExternalProfile({
      url, profile, fhirVersion,
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
    if (stored) this.runtime.policy.invalidate(false);
  }

  registerExternalProfile(
    sd: StructureDefinition,
    fhirVersion?: 'R4' | 'R5' | 'R6'
  ): boolean {
    const stored = storeExternalProfile({
      url: sd?.url, profile: sd, fhirVersion,
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
    if (stored) this.runtime.policy.invalidate(false);
    return stored;
  }

  /** Drop externally registered profiles only. Returns how many were removed. */
  clearExternalProfiles(): number {
    const removed = clearExternalProfiles({
      cache: this.runtime.cache,
      externalProfileCacheKeys: this.runtime.externalProfileCacheKeys,
      availableProfiles: this.runtime.availableProfiles,
      profileLoadPromises: this.runtime.profileLoadPromises,
    });
    if (removed) this.runtime.policy.invalidate(false);
    return removed;
  }

  clearCache(): void {
    this.runtime.clearCache();
  }

}
