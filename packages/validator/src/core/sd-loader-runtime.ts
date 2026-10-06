import { getBoundProfileSourceRevision, getProfileSourceCaptureScope, withProfileSourceSnapshot } from '../persistence/profile-source.js';
import { clearCanonicalPinCaches } from '../package/canonical-pin-context.js';
import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger.js';
import { getProfileSourceRevision, type ProfileSourceContext } from '../persistence/index.js';
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
import { ProfileMemoryCache } from './sd-loader-profile-memory-cache.js';
import { invalidateProfilePolicyCaches } from './sd-loader-policy-cache.js';
import { StructureDefinitionLoaderPolicyState } from './sd-loader-policy-state.js';
import type { StructureDefinition } from './structure-definition-types.js';

export type { StructureDefinitionLoaderOptions } from './sd-loader-options.js';

/** Mutable state and lifecycle shared by the StructureDefinitionLoader facade. */
export class StructureDefinitionLoaderRuntime {
  readonly cache = new ProfileMemoryCache();
  readonly availableProfiles: Set<string> = new Set();
  readonly profileLoadPromises = new Map<string, Promise<StructureDefinition | null>>();
  readonly externalProfileCacheKeys = new Set<string>();
  readonly autoDownloadState = new AutoDownloadState();
  readonly packageProfileIndexCache = new PackageProfileIndexCache();
  readonly packageSources: string[];
  readonly packageDownloader: PackageDownloader;
  readonly registryClient: PackageRegistryClient;
  readonly policy: StructureDefinitionLoaderPolicyState;

  private readonly capturedScopes = new WeakMap<object, { policyRevision: number; scope: object }>();
  private profileSourceRevision = getProfileSourceRevision();
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
      packageVersionPins: this.policy.getPackageVersionPins(),
      prewarmProfileSource: resolved.prewarmProfileSource,
      cache: this.cache,
      maxCacheEntries: this.maxCacheEntries,
      externalProfileCacheKeys: this.externalProfileCacheKeys,
    });
  }

  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  getDependencyCaptureScope(): object {
    const sourceRevision = getProfileSourceRevision();
    if (sourceRevision !== this.profileSourceRevision) {
      this.profileSourceRevision = sourceRevision;
      this.policy.invalidate(true);
    }
    const hostScope = getProfileSourceCaptureScope();
    let captured = this.capturedScopes.get(hostScope);
    if (captured?.policyRevision !== this.policy.revision) {
      captured = { policyRevision: this.policy.revision, scope: {} };
      this.capturedScopes.set(hostScope, captured);
    }
    return captured.scope;
  }

  loadProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    profileSourceContext?: ProfileSourceContext,
    profileResolutionSettings?: ValidationSettings,
  ): Promise<StructureDefinition | null> {
    return this.captureProfileResolver(profileSourceContext, profileResolutionSettings)(url, fhirVersion);
  }

  captureProfileResolver(profileSourceContext?: ProfileSourceContext, profileResolutionSettings?: ValidationSettings,
    options: { refreshHostProfile?: boolean; retainUnavailableFailures?: boolean } = {}) {
    const context = { ...this.loadContext(profileSourceContext, profileResolutionSettings), ...options };
    return (url: string, fhirVersion: 'R4' | 'R5' | 'R6') => withProfileSourceSnapshot(() => loadStructureDefinitionProfile(
      context,
      url,
      fhirVersion,
    )).finally(() => {
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
    logger.info('[SDLoader] Cache cleared');
  }

  private loadContext(
    profileSourceContext?: ProfileSourceContext,
    profileResolutionSettings?: ValidationSettings,
  ): LoadProfileContext {
    this.getDependencyCaptureScope();
    const policyRevision = this.policy.revision;
    const sourceRevision = getBoundProfileSourceRevision();
    return {
      availableProfiles: this.availableProfiles,
      externalProfileCacheKeys: this.externalProfileCacheKeys,
      packageSources: this.packageSources,
      cache: this.cache,
      profileLoadPromises: this.profileLoadPromises,
      autoDownload: this.policy.autoDownloadEnabled,
      registryClient: this.registryClient,
      packageDownloader: this.packageDownloader,
      allowedPackages: this.policy.getAllowedPackages(),
      packageVersionPins: this.policy.getPackageVersionPins(),
      selectedCorePackageId: this.policy.selectedCorePackage,
      profileSourcesConfig: this.policy.getProfileSourcesConfig(),
      profileSourceContext: profileSourceContext && structuredClone(profileSourceContext),
      profileResolutionSettings: profileResolutionSettings && structuredClone(profileResolutionSettings),
      resolvePinnedCanonical: this.policy.capturePinnedCanonicalResolver(),
      canCache: () => this.policy.revision === policyRevision && getProfileSourceRevision() === sourceRevision,
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
