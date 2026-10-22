/**
 * Profile-load pipeline for StructureDefinitionLoader.
 *
 * The full loadProfile() flow — pinned-canonical resolution, negative caches,
 * in-memory + DB cache checks, and the known-source fallback (local package
 * filesystem then auto-download). Extracted from structure-definition-loader.ts;
 * the loader passes its mutable caches/maps by reference so updates propagate
 * back, plus a resolvePinnedCanonical callback for its private pin map.
 */

import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import { logger } from '../logger.js';
import type { StructureDefinition } from './structure-definition-types.js';
import type { ProfileSourcesConfig, ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { loadFromLocalCache } from './sd-loader-filesystem.js';
import { loadExampleFolderProfile } from './sd-loader-example-profiles.js';
import { checkDatabaseCache } from './sd-loader-db-cache.js';
import { attemptAutoDownload, isPublicProfile, type AutoDownloadState } from './sd-loader-auto-download.js';
import {
  cacheKeyForProfile,
  normalizeVersionedCoreStructureDefinitionUrl,
  resolveProfileRequest,
  urlMatchesRequestedFhirVersion,
} from './sd-loader-version-utils.js';
import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import { FHIR_TYPE_TABLE_R4, FHIR_TYPE_TABLE_R5, FHIR_TYPE_TABLE_R6 } from '../input/fhir-type-table.generated.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import type { PackageProfileIndexCache } from './sd-loader-package-profile-index.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { ProfileReferenceUnavailableError } from './profile-reference-authority.js';
import {
  isTenantScopedProfileRequest,
  resolvedProfileMatchesRequest,
  resolveTenantProfileFromSource,
} from './tenant-profile-source-resolution.js';

export interface LoadProfileContext {
  availableProfiles: Set<string>;
  packageSources: string[];
  cache: Map<string, StructureDefinition>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
  autoDownload: boolean;
  registryClient: PackageRegistryClient;
  packageDownloader: PackageDownloader;
  allowedPackages: string[];
  packageVersionPins: Record<string, string>;
  selectedCorePackageId?: string;
  profileSourcesConfig: ProfileSourcesConfig;
  profileSourceContext?: ProfileSourceContext;
  profileResolutionSettings?: ValidationSettings;
  resolvePinnedCanonical(url: string): string;
  canCache?(): boolean;
  /** Unscoped references must read the host basis instead of borrowing a prior host result. */
  refreshHostProfile?: boolean;
  /** Legacy top-level loads keep null on failure; referenced definitions retain incomplete authority. */
  retainUnavailableFailures?: boolean;
  externalProfileCacheKeys?: ReadonlySet<string>;
  autoDownloadState: AutoDownloadState;
  packageProfileIndexCache?: PackageProfileIndexCache;
}

const coreTypes = { R4: FHIR_TYPE_TABLE_R4, R5: FHIR_TYPE_TABLE_R5, R6: FHIR_TYPE_TABLE_R6 };

/**
 * Load a StructureDefinition by URL.
 */
export async function loadProfile(
  ctx: LoadProfileContext,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): Promise<StructureDefinition | null> {
  try {
    // OPTIMIZATION: Skip filesystem scanning entirely - rely on DB cache + auto-download
    // Filesystem scans are extremely slow (30s for 36 packages with 1000+ profiles)
    // DB cache is fast (2ms) and auto-download handles missing profiles (20s timeout)
    // Canonical pinning: if the URL is unversioned and we have a pinned
    // resolution, redirect to the versioned form. This makes runtime
    // resolution deterministic regardless of which packages are loaded.
    if (!urlMatchesRequestedFhirVersion(url, fhirVersion)) {
      logger.debug('[SDLoader] Skipping FHIR-version-incompatible profile', {
        ...profileCanonicalMetadata(url),
        fhirVersion,
      });
      return null;
    }

    const lookupUrl = normalizeVersionedCoreStructureDefinitionUrl(url, fhirVersion);
    const resolvedUrl = resolveProfileRequest(url, fhirVersion, ctx.resolvePinnedCanonical.bind(ctx));
    if (!resolvedUrl) return null;
    const matchesRequest = (profile: StructureDefinition) =>
      resolvedProfileMatchesRequest(profile, url, fhirVersion, resolvedUrl);

    // Use version-specific cache key to avoid R4/R5 confusion
    const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);

    // For a tenant-scoped validation, non-core profiles must be resolved by
    // the embedder before any shared memory/DB/filesystem cache is consulted.
    // A null result intentionally stops here: globally installed but inactive
    // packages are not valid inputs for this organization.
    const scopedProfile = await resolveScopedProfile(
      ctx,
      resolvedUrl,
      fhirVersion,
    );
    if (scopedProfile !== undefined) {
      if (!scopedProfile || !matchesRequest(scopedProfile)) return null;
      const sanitized = sanitizeProfile(scopedProfile);
      if (policyAllowsCaching(ctx)) {
        ctx.cache.set(cacheKey, sanitized);
        ctx.availableProfiles.add(resolvedUrl);
      }
      return sanitized;
    }

    // A release pin owns core definitions. A mutable host cache can contain a
    // differently projected copy of the same version and must not replace it.
    const corePackage = ctx.selectedCorePackageId ?? `hl7.fhir.${fhirVersion.toLowerCase()}.core`;
    if (ctx.packageVersionPins[corePackage] && lookupUrl.startsWith('http://hl7.org/fhir/StructureDefinition/')) {
      const fixed = await loadFromLocalCache(resolvedUrl, ctx.packageSources, fhirVersion,
        ctx.packageVersionPins, ctx.packageProfileIndexCache, ctx.selectedCorePackageId);
      if (fixed && matchesRequest(fixed)) return sanitizeProfile(fixed);
      const type = lookupUrl.split('/').at(-1)?.split('|')[0] ?? '';
      if (ctx.profileSourceContext?.terminologySnapshotSha256 && Object.hasOwn(coreTypes[fhirVersion], type)) return null;
    }

    // Check in-memory cache first (version-specific)
    const cached = policyAllowsCaching(ctx) ? ctx.cache.get(cacheKey) : undefined;
    if (cached && matchesRequest(cached) && (!ctx.refreshHostProfile || ctx.externalProfileCacheKeys?.has(cacheKey))) {
      logger.debug('[SDLoader] Loading profile from in-memory cache', profileCanonicalMetadata(resolvedUrl));
      return cached;
    }
    if (cached && policyAllowsCaching(ctx)) ctx.cache.delete(cacheKey);

    // Check database cache (from ProfileResolver downloads)
    const dbCachedProfile = await checkDatabaseCache(
      resolvedUrl,
      fhirVersion,
      ctx.profileSourceContext,
    );
    if (dbCachedProfile && matchesRequest(dbCachedProfile)) {
      // Cache it in memory with version-specific key
      const sanitized = sanitizeProfile(dbCachedProfile);
      if (policyAllowsCaching(ctx)) {
        ctx.cache.set(cacheKey, sanitized);
        ctx.availableProfiles.add(resolvedUrl);
        if (lookupUrl !== resolvedUrl) ctx.availableProfiles.add(lookupUrl);
      }
      return sanitized;
    }

    // Skip scanning for private profiles UNLESS they're in availableProfiles
    const isInBundledProfiles = ctx.availableProfiles.has(url) ||
      ctx.availableProfiles.has(lookupUrl) ||
      ctx.availableProfiles.has(resolvedUrl);
    const publicProfile = isPublicProfile(lookupUrl);

    if (!publicProfile && !isInBundledProfiles) {
      logger.debug('[SDLoader] Skipping filesystem/auto-download for private profile', profileCanonicalMetadata(url));
      return null;
    }

    if (!publicProfile && isInBundledProfiles) {
      logger.debug('[SDLoader] Bundled profile will load from filesystem', profileCanonicalMetadata(url));
    }

    // OPTIMIZATION: Filesystem scanning disabled entirely
    // Filesystem scans are too slow (30s+ for 36 packages with 1000+ profiles)
    // DB cache (2ms) + auto-download (20s timeout) is much faster
    logger.debug('[SDLoader] Filesystem scan skipped by policy', profileCanonicalMetadata(url));

    // A legacy load may resolve failure as null; it cannot own a reference's completeness receipt.
    const pendingKey = ctx.retainUnavailableFailures ? `${cacheKey}:reference-authority` : cacheKey;
    const existingLoad = policyAllowsCaching(ctx) ? ctx.profileLoadPromises.get(pendingKey) : undefined;
    if (existingLoad) {
      const loaded = await existingLoad;
      return loaded && matchesRequest(loaded) ? loaded : null;
    }

    const loadPromise = loadProfileFromKnownSources(ctx, url, lookupUrl, resolvedUrl, cacheKey, fhirVersion).finally(() => {
      if (ctx.profileLoadPromises.get(pendingKey) === loadPromise) {
        ctx.profileLoadPromises.delete(pendingKey);
      }
    });

    if (policyAllowsCaching(ctx)) ctx.profileLoadPromises.set(pendingKey, loadPromise);
    const loaded = await loadPromise;
    return loaded && matchesRequest(loaded) ? loaded : null;

  } catch (error: unknown) {
    if (ctx.retainUnavailableFailures && error instanceof ProfileReferenceUnavailableError) throw error;
    logger.error(
      '[SDLoader] Profile load failed',
      validationFailureMetadata(error),
    );
    return null;
  }
}

/** undefined = normal unscoped pipeline; null = scoped lookup was authoritative but missed. */
async function resolveScopedProfile(
  ctx: LoadProfileContext,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null | undefined> {
  const context = ctx.profileSourceContext;
  if (!isTenantScopedProfileRequest(url, context)) {
    return undefined;
  }

  const profile = await resolveTenantProfileFromSource(
    url,
    fhirVersion,
    context,
    ctx.profileResolutionSettings,
  );
  if (!profile) return null;
  return resolvedProfileMatchesRequest(profile, url, fhirVersion) ? profile : null;
}

function hasExplicitCanonicalVersion(url: string): boolean {
  const separatorIndex = url.indexOf('|');
  return separatorIndex > 0 && separatorIndex < url.length - 1;
}

async function loadProfileFromKnownSources(
  ctx: LoadProfileContext,
  url: string,
  lookupUrl: string,
  resolvedUrl: string,
  cacheKey: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null> {
  const shouldTryFilesystem =
    ctx.availableProfiles.has(url) ||
    ctx.availableProfiles.has(lookupUrl) ||
    ctx.availableProfiles.has(resolvedUrl) ||
    hasExplicitCanonicalVersion(resolvedUrl);

  if (shouldTryFilesystem) {
    logger.debug('[SDLoader] Loading profile from filesystem', profileCanonicalMetadata(url));
    const sd = await loadFromLocalCache(
      resolvedUrl,
      ctx.packageSources,
      fhirVersion,
      ctx.packageVersionPins,
      ctx.packageProfileIndexCache,
      ctx.selectedCorePackageId,
    );

    if (sd && resolvedProfileMatchesRequest(sd, url, fhirVersion, resolvedUrl)) {
      const sanitized = sanitizeProfile(sd);
      if (policyAllowsCaching(ctx)) ctx.cache.set(cacheKey, sanitized);
      return sanitized;
    }

    logger.warn('[SDLoader] Available profile failed to load', profileCanonicalMetadata(url));
  }

  const exampleProfile = await loadExampleFolderProfile(resolvedUrl, ctx.packageSources, fhirVersion);
  if (exampleProfile && resolvedProfileMatchesRequest(exampleProfile, url, fhirVersion, resolvedUrl)) {
    const sanitized = sanitizeProfile(exampleProfile);
    if (policyAllowsCaching(ctx)) ctx.cache.set(cacheKey, sanitized);
    return sanitized;
  }

  if (ctx.autoDownload) {
    const downloadedProfile = await attemptAutoDownload(resolvedUrl, {
      registryClient: ctx.registryClient,
      packageDownloader: ctx.packageDownloader,
      allowedPackages: ctx.allowedPackages,
      packageVersionPins: ctx.packageVersionPins,
      selectedCorePackageId: ctx.selectedCorePackageId,
      packageSources: ctx.packageSources,
      cache: ctx.cache,
      availableProfiles: ctx.availableProfiles,
      profileSourcesConfig: ctx.profileSourcesConfig,
      fhirVersion,
      canCache: ctx.canCache,
      autoDownloadState: ctx.autoDownloadState,
      retainUnavailableFailures: ctx.retainUnavailableFailures,
      packageProfileIndexCache: ctx.packageProfileIndexCache,
    });

    if (downloadedProfile && resolvedProfileMatchesRequest(downloadedProfile, url, fhirVersion, resolvedUrl)) {
      const sanitized = sanitizeProfile(downloadedProfile);
      if (policyAllowsCaching(ctx)) ctx.cache.set(cacheKey, sanitized);
      return sanitized;
    }

    logger.warn('[SDLoader] Profile not found', profileCanonicalMetadata(url));
    logger.debug('[SDLoader] Auto-download was enabled');
    return null;
  }

  logger.warn('[SDLoader] Profile not found', profileCanonicalMetadata(url));
  logger.debug('[SDLoader] Auto-download was disabled');
  return null;
}

function policyAllowsCaching(ctx: LoadProfileContext): boolean {
  return ctx.canCache?.() ?? true;
}
