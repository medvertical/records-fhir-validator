import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { compareVersions, parsePackageName } from './sd-loader-package-scanner.js';
import { matchesRequestedFhirVersion, type FhirVersionFamily } from './sd-loader-version-utils.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import {
  addProfileToIndex,
  loadCanonicalUrlsFromPackageIndex,
  readProfileFile,
  type IndexedProfile,
  type PackageProfileIndex,
} from './sd-loader-package-profile-reader.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

export type { IndexedProfile, PackageProfileIndex } from './sd-loader-package-profile-reader.js';

type CachedPackageProfileIndex = {
  signature: string;
  promise: Promise<PackageProfileIndex>;
};

type CachedPackageCanonicalIndex = {
  signature: string;
  /** Canonical URL to the package files that declare it, or null without an index. */
  promise: Promise<Map<string, string[]> | null>;
};

const MAX_PACKAGE_PROFILE_INDEX_ENTRIES = 256;
const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

export class PackageProfileIndexCache {
  private readonly profileIndexes = new BoundedLruCache<string, CachedPackageProfileIndex>(
    MAX_PACKAGE_PROFILE_INDEX_ENTRIES,
  );
  private readonly canonicalIndexes = new BoundedLruCache<string, CachedPackageCanonicalIndex>(
    MAX_PACKAGE_PROFILE_INDEX_ENTRIES,
  );

  async mayContainCanonical(packagePath: string, targetUrl: string): Promise<boolean> {
    const indexPath = path.join(packagePath, '.index.json');
    let signature: string;
    try {
      const stats = await fs.stat(indexPath, { bigint: true });
      if (!stats.isFile() || stats.size > BigInt(MAX_PACKAGE_INDEX_BYTES)) return true;
      signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
    } catch {
      return true;
    }

    let cached = this.canonicalIndexes.get(indexPath);
    if (cached?.signature !== signature) {
      cached = {
        signature,
        promise: loadCanonicalUrlsFromPackageIndex(indexPath),
      };
      this.canonicalIndexes.set(indexPath, cached);
    }

    const canonicalUrls = await cached.promise;
    return canonicalUrls?.has(targetUrl) ?? true;
  }

  /**
   * The profiles a package declares for one canonical, read from the files the
   * package index names. Building the whole package index instead reads every
   * JSON file in it — 4 583 files and 37 MB for `hl7.fhir.r4.core`, to return
   * one profile — while the 1.2 MB index beside them already carries the URL,
   * version and filename of all 658 StructureDefinitions.
   *
   * Returns null when the package ships no usable index or the index names no
   * file for this canonical, so the caller falls back to the full build and a
   * profile that the index happens to omit is still found.
   */
  async loadProfilesForCanonical(
    packagePath: string,
    packageName: string,
    targetUrl: string,
  ): Promise<PackageProfileIndex | null> {
    const filenames = (await this.canonicalFilenames(packagePath))?.get(targetUrl);
    if (!filenames || filenames.length === 0) return null;

    const index: PackageProfileIndex = { byUrl: new Map(), byVersionedUrl: new Map() };
    for (const filename of filenames) {
      const profile = await readProfileFile(packagePath, filename);
      if (profile) addProfileToIndex(index, profile, packageName, filename);
    }
    return index.byUrl.size === 0 ? null : index;
  }

  private async canonicalFilenames(packagePath: string): Promise<Map<string, string[]> | null> {
    const indexPath = path.join(packagePath, '.index.json');
    let signature: string;
    try {
      const stats = await fs.stat(indexPath, { bigint: true });
      if (!stats.isFile() || stats.size > BigInt(MAX_PACKAGE_INDEX_BYTES)) return null;
      signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
    } catch {
      return null;
    }

    let cached = this.canonicalIndexes.get(indexPath);
    if (cached?.signature !== signature) {
      cached = { signature, promise: loadCanonicalUrlsFromPackageIndex(indexPath) };
      this.canonicalIndexes.set(indexPath, cached);
    }
    return cached.promise;
  }

  async loadProfileIndex(
    packagePath: string,
    packageName: string,
    preferredResourceType: string,
  ): Promise<PackageProfileIndex> {
    const signature = await packageDirectorySignature(packagePath);
    const existing = this.profileIndexes.get(packagePath);
    if (existing?.signature === signature) return existing.promise;

    const entry: CachedPackageProfileIndex = {
      signature,
      promise: buildPackageProfileIndex(packagePath, packageName, preferredResourceType),
    };
    this.profileIndexes.set(packagePath, entry);

    try {
      return await entry.promise;
    } catch (error) {
      if (this.profileIndexes.get(packagePath) === entry) {
        this.profileIndexes.delete(packagePath);
      }
      throw error;
    }
  }

  clear(): void {
    this.profileIndexes.clear();
    this.canonicalIndexes.clear();
  }
}

/**
 * Use the standard FHIR package index as a cheap negative lookup. A missing,
 * oversized, or malformed index is treated as unknown so third-party package
 * layouts still fall back to the complete filesystem scan.
 */
export async function packageIndexMayContainCanonical(
  packagePath: string,
  targetUrl: string,
  indexCache: PackageProfileIndexCache = new PackageProfileIndexCache(),
): Promise<boolean> {
  return indexCache.mayContainCanonical(packagePath, targetUrl);
}

/**
 * The profiles one package declares for a canonical, read from the files its
 * index names, or null when there is no usable index for it.
 */
export async function loadProfilesForCanonical(
  packagePath: string,
  packageName: string,
  targetUrl: string,
  indexCache: PackageProfileIndexCache = new PackageProfileIndexCache(),
): Promise<PackageProfileIndex | null> {
  return indexCache.loadProfilesForCanonical(packagePath, packageName, targetUrl);
}

export async function loadPackageProfileIndex(
  packagePath: string,
  packageName: string,
  preferredResourceType: string,
  indexCache: PackageProfileIndexCache = new PackageProfileIndexCache(),
): Promise<PackageProfileIndex> {
  return indexCache.loadProfileIndex(packagePath, packageName, preferredResourceType);
}

export function selectExactProfile(
  index: PackageProfileIndex,
  targetUrl: string,
  targetVersion: string | undefined,
  fhirVersion: FhirVersionFamily,
  packageVersionPins: Readonly<Record<string, string>> = {},
): IndexedProfile | null {
  if (targetVersion) {
    const exact = index.byVersionedUrl.get(`${targetUrl}|${targetVersion}`);
    if (exact && matchesRequestedFhirVersion(exact.sd, fhirVersion)) return exact;

    const candidates = index.byUrl.get(targetUrl) ?? [];
    return candidates.find(candidate =>
      typeof candidate.sd.version === 'string'
      && matchesRequestedFhirVersion(candidate.sd, fhirVersion)
      && canonicalVersionsAreEquivalent(targetVersion, candidate.sd.version)
    ) ?? null;
  }

  const candidates = index.byUrl.get(targetUrl) ?? [];
  let preRelease: IndexedProfile | null = null;
  for (const candidate of candidates) {
    if (!matchesRequestedFhirVersion(candidate.sd, fhirVersion)) {
      logger.info(
        '[SDLoader] Skipping FHIR-version-incompatible profile',
        profileCanonicalMetadata(targetUrl, candidate.sd.version),
      );
      continue;
    }
    if (
      isPreReleaseVersion(candidate.sd.version)
      && !allowsUnversionedPreRelease(targetUrl, candidate, fhirVersion, packageVersionPins)
    ) {
      preRelease ??= candidate;
      continue;
    }
    return candidate;
  }
  return preRelease ?? null;
}

/**
 * Picks between two candidates that the per-package selectors already found
 * acceptable, so it needs no canonical, FHIR version or pin: those decided
 * acceptability, this decides precedence.
 */
export function selectBetterUnversionedProfile(
  current: IndexedProfile | null,
  candidate: IndexedProfile,
): IndexedProfile | null {
  if (!current) return candidate;

  // Release beats pre-release regardless of the numbers: 1.0.0-ballot sorts
  // above 0.9.0 but is still the draft of a canonical that has a published
  // answer. Only within one maturity does the version decide.
  const candidateIsPreRelease = isPreReleaseVersion(candidate.sd.version);
  const currentIsPreRelease = isPreReleaseVersion(current.sd.version);
  if (candidateIsPreRelease !== currentIsPreRelease) {
    return candidateIsPreRelease ? current : candidate;
  }

  const candidateVersion = candidate.sd.version || '0.0.0';
  const currentVersion = current.sd.version || '0.0.0';
  return compareVersions(candidateVersion, currentVersion) > 0 ? candidate : current;
}

export function selectUnversionedCandidate(
  index: PackageProfileIndex,
  targetUrl: string,
  fhirVersion: FhirVersionFamily,
  packageVersionPins: Readonly<Record<string, string>> = {},
): IndexedProfile | null {
  const candidates = index.byUrl.get(targetUrl) ?? [];
  let preRelease: IndexedProfile | null = null;
  for (const candidate of candidates) {
    if (!matchesRequestedFhirVersion(candidate.sd, fhirVersion)) continue;
    if (
      !isPreReleaseVersion(candidate.sd.version)
      || allowsUnversionedPreRelease(targetUrl, candidate, fhirVersion, packageVersionPins)
    ) {
      return candidate;
    }
    preRelease ??= candidate;
  }
  return preRelease ?? null;
}

async function buildPackageProfileIndex(
  packagePath: string,
  packageName: string,
  preferredResourceType: string,
): Promise<PackageProfileIndex> {
  const index: PackageProfileIndex = {
    byUrl: new Map(),
    byVersionedUrl: new Map(),
  };
  const preferredFile = `StructureDefinition-${preferredResourceType}.json`;
  const jsonFiles = (await fs.readdir(packagePath))
    .filter(file => file.endsWith('.json'))
    .sort((left, right) => {
      if (left === preferredFile) return -1;
      if (right === preferredFile) return 1;
      return left.localeCompare(right);
    });

  for (const file of jsonFiles) {
    const profile = await readProfileFile(packagePath, file);
    if (profile) addProfileToIndex(index, profile, packageName, file);
  }
  return index;
}

async function packageDirectorySignature(packagePath: string): Promise<string> {
  const stats = await fs.stat(packagePath, { bigint: true });
  return `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
}





function canonicalVersionsAreEquivalent(requested: string, actual: string): boolean {
  if (requested === actual) return true;
  return normalizeShortSemverVersion(requested) === normalizeShortSemverVersion(actual);
}

function normalizeShortSemverVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.0` : version;
}

function isPreReleaseVersion(version: string | undefined): boolean {
  return typeof version === 'string' && version.includes('-');
}

/**
 * Whether a pre-release may be taken *ahead of* a released profile. It is not
 * what decides a ballot IG's fate: when the cache holds no released version of
 * a canonical, the selectors fall back to the pre-release anyway. Refusing it
 * there would not reach a safer profile — there is none — it would validate
 * against the base resource and report the profile as unresolvable while it
 * sits in the package the reader installed on purpose.
 */
function allowsUnversionedPreRelease(
  targetUrl: string,
  candidate: IndexedProfile,
  fhirVersion?: FhirVersionFamily,
  packageVersionPins: Readonly<Record<string, string>> = {},
): boolean {
  const sourcePackage = parsePackageName(candidate.sourceName.split('/')[0]);
  // An explicit package pin selects that release even when its SD version differs.
  if (sourcePackage && packageVersionPins[sourcePackage.baseName] === sourcePackage.version) return true;
  return fhirVersion === 'R6'
    && /^https?:\/\/hl7\.org\/fhir\/StructureDefinition\//.test(targetUrl)
    && candidate.sourceName.toLowerCase().startsWith('hl7.fhir.r6.core#');
}
