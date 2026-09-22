import { clearCanonicalPinCaches } from '../package/canonical-pin-context.js';
import { clearProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { AutoDownloadState } from './sd-loader-auto-download.js';
import {
  hasRequiredBaseProfiles,
  initializeStructureDefinitionCache,
  pruneReloadableProfileCache,
} from './sd-loader-cache-runtime.js';
import {
  loadProfile as loadStructureDefinitionProfile,
  type LoadProfileContext,
} from './sd-loader-load.js';
import {
  resolveStructureDefinitionLoaderOptions,
  type StructureDefinitionLoaderOptions,
} from './sd-loader-options.js';
import { PackageProfileIndexCache } from './sd-loader-package-profile-index.js';
import { invalidateProfilePolicyCaches } from './sd-loader-policy-cache.js';
import { StructureDefinitionLoaderPolicyState } from './sd-loader-policy-state.js';
import type { StructureDefinition } from './structure-definition-types.js';

export type { StructureDefinitionLoaderOptions } from './sd-loader-options.js';

/** Mutable state and lifecycle shared by the StructureDefinitionLoader facade. */
export class StructureDefinitionLoaderRuntime {
  readonly cache: Map<string, StructureDefinition> = new Map();
  readonly availableProfiles: Set<string> = new Set();
  readonly profileLoadPromises = new Map<string, Promise<StructureDefinition | null>>();
  readonly externalProfileCacheKeys = new Set<string>();
  readonly autoDownloadState = new AutoDownloadState();
  readonly packageProfileIndexCache = new PackageProfileIndexCache();
  readonly packageSources: string[];
  readonly packageDownloader: PackageDownloader;
  readonly registryClient: PackageRegistryClient;
  readonly policy: StructureDefinitionLoaderPolicyState;

  private readonly maxCacheEntries: number;
  private readonly initializationPromise: Promise<void>;

  constructor(
    readonly cachePath: string,
    bundledPath?: string | null,
    options?: StructureDefinitionLoaderOptions,
  ) {
    const resolved = resolveStructureDefinitionLoaderOptions(cachePath, bundledPath, options);
    this.registryClient = resolved.registryClient;
    this.packageDownloader = resolved.packageDownloader;
    this.maxCacheEntries = resolved.maxCacheEntries;
    this.packageSources = resolved.packageSources;
    this.policy = new StructureDefinitionLoaderPolicyState(resolved, clearReloadableCache => {
      this.autoDownloadState.clear();
      this.packageProfileIndexCache.clear();
      invalidateProfilePolicyCaches({
        cache: this.cache,
        externalProfileCacheKeys: this.externalProfileCacheKeys,
        profileLoadPromises: this.profileLoadPromises,
      }, clearReloadableCache);
    });

    logLoaderConfiguration(this.packageSources, this.policy);
    this.initializationPromise = initializeStructureDefinitionCache({
      packageSources: this.packageSources,
      availableProfiles: this.availableProfiles,
      packageVersionPins: this.policy.packagePins,
      prewarmProfileSource: resolved.prewarmProfileSource,
      cache: this.cache,
      maxCacheEntries: this.maxCacheEntries,
      externalProfileCacheKeys: this.externalProfileCacheKeys,
    });
  }

  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  loadProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    profileSourceContext?: ProfileSourceContext,
    profileResolutionSettings?: ValidationSettings,
  ): Promise<StructureDefinition | null> {
    return loadStructureDefinitionProfile(
      this.loadContext(profileSourceContext, profileResolutionSettings),
      url,
      fhirVersion,
    ).finally(() => {
      this.pruneProfileCache();
    });
  }

  pruneProfileCache(): void {
    pruneReloadableProfileCache(
      this.cache,
      this.maxCacheEntries,
      this.externalProfileCacheKeys,
    );
  }

  hasBaseProfiles(): boolean {
    return hasRequiredBaseProfiles(this.availableProfiles);
  }

  clearCache(): void {
    this.policy.invalidate();
    this.cache.clear();
    this.externalProfileCacheKeys.clear();
    // Pin caches mirror the on-disk package stores the profile cache was
    // filled from; both must reset together or pins go stale after installs.
    clearCanonicalPinCaches();
    clearProfilePackageProvenance();
    logger.info('[SDLoader] Cache cleared');
  }

  private loadContext(
    profileSourceContext?: ProfileSourceContext,
    profileResolutionSettings?: ValidationSettings,
  ): LoadProfileContext {
    const policyRevision = this.policy.revision;
    return {
      availableProfiles: this.availableProfiles,
      packageSources: this.packageSources,
      cache: this.cache,
      profileLoadPromises: this.profileLoadPromises,
      autoDownload: this.policy.autoDownloadEnabled,
      registryClient: this.registryClient,
      packageDownloader: this.packageDownloader,
      allowedPackages: this.policy.allowedPackageList,
      packageVersionPins: this.policy.packagePins,
      selectedCorePackageId: this.policy.selectedCorePackage,
      profileSourcesConfig: this.policy.profileSources,
      profileSourceContext,
      profileResolutionSettings,
      resolvePinnedCanonical: candidateUrl => this.policy.resolvePinnedCanonical(candidateUrl),
      canCache: () => this.policy.revision === policyRevision,
      autoDownloadState: this.autoDownloadState,
      packageProfileIndexCache: this.packageProfileIndexCache,
    };
  }
}

function logLoaderConfiguration(
  packageSources: readonly string[],
  policy: StructureDefinitionLoaderPolicyState,
): void {
  logger.info('[SDLoader] Package sources configured', {
    sourceCount: packageSources.length,
    ...sensitiveValueMetadata(...packageSources),
  });
  logger.info(`[SDLoader] Auto-download: ${policy.autoDownloadEnabled ? 'enabled' : 'disabled'}`);
  if (policy.autoDownloadEnabled) {
    logger.debug('[SDLoader] Allowed packages configured', {
      packageCount: policy.allowedPackageList.length,
      ...sensitiveValueMetadata(...policy.allowedPackageList),
    });
  }
}
