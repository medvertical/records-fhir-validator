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
import { logger } from '../logger';
import type { StructureDefinition } from './structure-definition-types';
import type { ProfileSourcesConfig } from '../types';
import { loadFromLocalCache } from './sd-loader-filesystem';
import { checkDatabaseCache } from './sd-loader-db-cache';
import { attemptAutoDownload, isPublicProfile } from './sd-loader-auto-download';
import { cacheKeyForProfile, urlMatchesRequestedFhirVersion } from './sd-loader-version-utils';
import { sanitizeProfile } from './sd-loader-profile-sanitizer';

export interface LoadProfileContext {
  availableProfiles: Set<string>;
  packageSources: string[];
  cache: Map<string, StructureDefinition>;
  profileNotFound: Set<string>;
  dbCacheNotFound: Set<string>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
  autoDownload: boolean;
  registryClient: PackageRegistryClient;
  packageDownloader: PackageDownloader;
  allowedPackages: string[];
  packageVersionPins: Record<string, string>;
  profileSourcesConfig: ProfileSourcesConfig;
  resolvePinnedCanonical(url: string): string;
}

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
    const resolvedUrl = ctx.resolvePinnedCanonical(url);

    // Use version-specific cache key to avoid R4/R5 confusion
    const cacheKey = cacheKeyForProfile(resolvedUrl, fhirVersion);

    if (ctx.profileNotFound.has(cacheKey)) {
      logger.debug(`[SDLoader] Skipping profile load for ${cacheKey} (known not found)`);
      return null;
    }

    if (!urlMatchesRequestedFhirVersion(resolvedUrl, fhirVersion)) {
      logger.debug(`[SDLoader] Skipping FHIR-version-incompatible profile URL: ${resolvedUrl} (${fhirVersion})`);
      ctx.profileNotFound.add(cacheKey);
      return null;
    }

    // Check in-memory cache first (version-specific)
    if (ctx.cache.has(cacheKey)) {
      logger.debug(`[SDLoader] Loading from in-memory cache: ${cacheKey}`);
      return ctx.cache.get(cacheKey)!;
    }

    // Check database cache (from ProfileResolver downloads)
    const dbCachedProfile = await checkDatabaseCache(url, ctx.dbCacheNotFound, fhirVersion);
    if (dbCachedProfile) {
      // Cache it in memory with version-specific key
      const sanitized = sanitizeProfile(dbCachedProfile);
      ctx.cache.set(cacheKey, sanitized);
      ctx.availableProfiles.add(url);
      ctx.profileNotFound.delete(cacheKey);
      return sanitized;
    }

    // If profile was not found in DB cache, skip filesystem check
    // (DB is the source of truth for downloaded profiles)
    if (ctx.dbCacheNotFound.has(url)) {
      logger.debug(`[SDLoader] Skipping filesystem check for ${url} (in negative cache)`);
    }

    // Skip scanning for private profiles UNLESS they're in availableProfiles
    const isInBundledProfiles = ctx.availableProfiles.has(url) || ctx.availableProfiles.has(resolvedUrl);
    const publicProfile = isPublicProfile(url);

    if (!publicProfile && !isInBundledProfiles) {
      logger.debug(`[SDLoader] Skipping filesystem/auto-download for private/custom profile: ${url}`);
      ctx.profileNotFound.add(cacheKey);
      return null;
    }

    if (!publicProfile && isInBundledProfiles) {
      logger.debug(`[SDLoader] Profile ${url} is in bundled packages, attempting to load from filesystem`);
    }

    // OPTIMIZATION: Filesystem scanning disabled entirely
    // Filesystem scans are too slow (30s+ for 36 packages with 1000+ profiles)
    // DB cache (2ms) + auto-download (20s timeout) is much faster
    logger.debug(`[SDLoader] Skipped filesystem cache for ${url} (filesystem scanning disabled)`);

    const existingLoad = ctx.profileLoadPromises.get(cacheKey);
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = loadProfileFromKnownSources(ctx, url, resolvedUrl, cacheKey, fhirVersion).finally(() => {
      ctx.profileLoadPromises.delete(cacheKey);
    });

    ctx.profileLoadPromises.set(cacheKey, loadPromise);
    return loadPromise;

  } catch (error: unknown) {
    logger.error(`[SDLoader] Error loading profile ${url}:`, error);
    return null;
  }
}

async function loadProfileFromKnownSources(
  ctx: LoadProfileContext,
  url: string,
  resolvedUrl: string,
  cacheKey: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null> {
  if (ctx.availableProfiles.has(url) || ctx.availableProfiles.has(resolvedUrl)) {
    logger.debug(`[SDLoader] Profile found in availableProfiles, loading from filesystem: ${url}`);
    const sd = await loadFromLocalCache(resolvedUrl, ctx.packageSources, fhirVersion);

    if (sd) {
      const sanitized = sanitizeProfile(sd);
      ctx.cache.set(cacheKey, sanitized);
      ctx.profileNotFound.delete(cacheKey);
      return sanitized;
    }

    logger.warn(`[SDLoader] Profile in availableProfiles but failed to load: ${url}`);
    ctx.profileNotFound.add(cacheKey);
    return null;
  }

  if (ctx.autoDownload) {
    const downloadedProfile = await attemptAutoDownload(url, {
      registryClient: ctx.registryClient,
      packageDownloader: ctx.packageDownloader,
      allowedPackages: ctx.allowedPackages,
      packageVersionPins: ctx.packageVersionPins,
      packageSources: ctx.packageSources,
      cache: ctx.cache,
      availableProfiles: ctx.availableProfiles,
      profileSourcesConfig: ctx.profileSourcesConfig,
      fhirVersion,
    });

    if (downloadedProfile) {
      const sanitized = sanitizeProfile(downloadedProfile);
      ctx.cache.set(cacheKey, sanitized);
      ctx.profileNotFound.delete(cacheKey);
      return sanitized;
    }

    logger.warn(`[SDLoader] Profile not found: ${url}`);
    logger.debug('[SDLoader] Auto-download was enabled');
    ctx.profileNotFound.add(cacheKey);
    return null;
  }

  logger.warn(`[SDLoader] Profile not found: ${url}`);
  logger.debug('[SDLoader] Auto-download was disabled');
  ctx.profileNotFound.add(cacheKey);
  return null;
}
