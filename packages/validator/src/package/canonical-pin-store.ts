import { parsePackageDirName, readInstalledManifestCandidates } from './canonical-pin-manifest-candidates.js';
/**
 * Read-only access to installed FHIR package stores for IG dependency
 * pinning. A package's `package.json` declares which dependency versions the
 * IG was published against; its `.index.json` maps canonical URLs to the
 * resource versions shipped in exactly that package version. Both are needed
 * to translate a package-level pin (name -> package version) into the
 * resource-level version a canonical URL must resolve to.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { reportUnreadablePackageStore } from './package-store-diagnostics.js';

import type { PackageRef, InstalledPackageManifest, PackageManifestCandidate } from './canonical-pin-manifest-candidates.js';
export type { PackageRef, InstalledPackageManifest, UnavailablePackageManifest, PackageManifestCandidate } from './canonical-pin-manifest-candidates.js';

// Package indexes above this size are skipped: parsing them on the hot path
// costs more than the pin precision they would add, mirroring the guard in
// the ValueSet package search.
const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGE_RESOURCE_BYTES = 32 * 1024 * 1024;

interface CachedStoreManifests {
  signature: string;
  promise: Promise<InstalledPackageManifest[]>;
}

interface CachedCanonicalVersions {
  signature: string;
  promise: Promise<Map<string, string> | null>;
}

export interface CanonicalVersionLookupOptions {
  /**
   * Read the package's resource files when it ships no `.index.json`, as
   * older IG packages such as ISiK Basismodul 2.0.0 do. An index the size
   * guard rejects, or one that does not parse, is not worked around this way:
   * such packages cost more than the pins they would add.
   */
  scanWithoutIndex?: boolean;
}

export class CanonicalPinStore {
  private readonly storeManifests = new BoundedLruCache<string, CachedStoreManifests>(16);
  private readonly canonicalVersions = new BoundedLruCache<string, CachedCanonicalVersions>(128);
  private readonly scannedCanonicalVersions = new BoundedLruCache<string, CachedCanonicalVersions>(64);

  /** Installed package manifests across the given stores, in store order. */
  async listInstalledManifests(storeDirs: readonly string[]): Promise<InstalledPackageManifest[]> {
    const manifests: InstalledPackageManifest[] = [];
    for (const [storeRank, storeDir] of storeDirs.entries()) {
      manifests.push(...await this.listStoreManifests(storeDir, storeRank));
    }
    return manifests;
  }

  /** Required reference resolution retains opaque copies at their original store position. */
  listInstalledManifestCandidates(storeDirs: readonly string[]): Promise<PackageManifestCandidate[]> {
    return readInstalledManifestCandidates(storeDirs);
  }

  /**
   * Resource version of `canonicalUrl` inside the exact installed package
   * `ref`, or null when the package is absent or does not ship the canonical.
   */
  async findCanonicalResourceVersion(
    storeDirs: readonly string[],
    ref: PackageRef,
    canonicalUrl: string,
    options: CanonicalVersionLookupOptions = {},
  ): Promise<string | null> {
    for (const storeDir of storeDirs) {
      const packagePath = path.join(storeDir, `${ref.name}#${ref.version}`, 'package');
      const versions = await this.loadCanonicalVersions(packagePath)
        ?? (options.scanWithoutIndex ? await this.scanCanonicalVersions(packagePath) : null);
      if (!versions) continue;
      const version = versions.get(canonicalUrl);
      if (version) return version;
      // The package is installed here but does not ship this canonical —
      // other stores hold other packages, not other content for this ref.
      return null;
    }
    return null;
  }

  /** Changes whenever a package is installed into or removed from a store. */
  async storeSignature(storeDirs: readonly string[]): Promise<string> {
    const parts: string[] = [];
    for (const storeDir of storeDirs) {
      try {
        const stats = await fs.stat(storeDir, { bigint: true });
        parts.push(`${storeDir}:${stats.dev}:${stats.ino}:${stats.mtimeNs}`);
      } catch {
        parts.push(`${storeDir}:unreadable`);
      }
    }
    return parts.join('\0');
  }

  clear(): void {
    this.storeManifests.clear();
    this.canonicalVersions.clear();
    this.scannedCanonicalVersions.clear();
  }

  private async listStoreManifests(
    storeDir: string,
    storeRank: number,
  ): Promise<InstalledPackageManifest[]> {
    let signature: string;
    try {
      const stats = await fs.stat(storeDir, { bigint: true });
      if (!stats.isDirectory()) return [];
      signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${storeRank}`;
    } catch (error: unknown) {
      reportUnreadablePackageStore('CanonicalPinStore', storeDir, error);
      return [];
    }

    let cached = this.storeManifests.get(storeDir);
    if (cached?.signature !== signature) {
      cached = { signature, promise: readStoreManifests(storeDir, storeRank) };
      this.storeManifests.set(storeDir, cached);
    }
    return cached.promise;
  }

  private async loadCanonicalVersions(packagePath: string): Promise<Map<string, string> | null> {
    const indexPath = path.join(packagePath, '.index.json');
    let signature: string;
    try {
      const stats = await fs.stat(indexPath, { bigint: true });
      if (!stats.isFile() || stats.size > BigInt(MAX_PACKAGE_INDEX_BYTES)) return null;
      signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.size}`;
    } catch {
      return null;
    }

    let cached = this.canonicalVersions.get(indexPath);
    if (cached?.signature !== signature) {
      cached = { signature, promise: readCanonicalVersions(indexPath) };
      this.canonicalVersions.set(indexPath, cached);
    }
    return cached.promise;
  }

  private async scanCanonicalVersions(packagePath: string): Promise<Map<string, string> | null> {
    let signature: string;
    try {
      const stats = await fs.stat(packagePath, { bigint: true });
      if (!stats.isDirectory() || await shipsIndex(packagePath)) return null;
      signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}`;
    } catch {
      return null;
    }

    let cached = this.scannedCanonicalVersions.get(packagePath);
    if (cached?.signature !== signature) {
      cached = { signature, promise: scanCanonicalVersions(packagePath) };
      this.scannedCanonicalVersions.set(packagePath, cached);
    }
    return cached.promise;
  }
}

async function readStoreManifests(
  storeDir: string,
  storeRank: number,
): Promise<InstalledPackageManifest[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(storeDir)).sort();
  } catch (error: unknown) {
    reportUnreadablePackageStore('CanonicalPinStore', storeDir, error);
    return [];
  }

  const manifests: InstalledPackageManifest[] = [];
  for (const entry of entries) {
    const ref = parsePackageDirName(entry);
    if (!ref) continue;
    const manifest = await readPackageManifest(path.join(storeDir, entry, 'package', 'package.json'), ref, storeRank);
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

async function readPackageManifest(
  manifestPath: string,
  ref: PackageRef,
  storeRank: number,
): Promise<InstalledPackageManifest | null> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const dependencies: PackageRef[] = [];
  const rawDependencies = parsed.dependencies;
  if (rawDependencies && typeof rawDependencies === 'object' && !Array.isArray(rawDependencies)) {
    // JSON object order preserves the IG's declared dependency order, which
    // is the documented pin precedence after the package's own content.
    for (const [name, version] of Object.entries(rawDependencies as Record<string, unknown>)) {
      if (typeof version === 'string' && version.length > 0) {
        dependencies.push({ name, version });
      }
    }
  }

  return {
    ref,
    canonical: typeof parsed.canonical === 'string' && parsed.canonical.length > 0
      ? parsed.canonical.replace(/\/+$/, '')
      : null,
    fhirVersions: Array.isArray(parsed.fhirVersions)
      ? (parsed.fhirVersions as unknown[]).filter((value): value is string => typeof value === 'string')
      : [],
    dependencies,
    storeRank,
  };
}

async function readCanonicalVersions(indexPath: string): Promise<Map<string, string> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return null;

    const versions = new Map<string, string>();
    for (const entry of parsed.files) {
      if (!entry || typeof entry !== 'object') continue;
      const { url, version } = entry as { url?: unknown; version?: unknown };
      if (typeof url !== 'string' || typeof version !== 'string' || version.length === 0) continue;
      if (!versions.has(url)) versions.set(url, version);
    }
    return versions;
  } catch {
    return null;
  }
}

async function shipsIndex(packagePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(packagePath, '.index.json'));
    return true;
  } catch {
    return false;
  }
}

async function scanCanonicalVersions(packagePath: string): Promise<Map<string, string> | null> {
  let files: string[];
  try {
    files = (await fs.readdir(packagePath))
      .filter(file => file.endsWith('.json') && file !== 'package.json' && file !== '.index.json')
      .sort();
  } catch {
    return null;
  }

  const versions = new Map<string, string>();
  for (const file of files) {
    try {
      const filePath = path.join(packagePath, file);
      if ((await fs.stat(filePath)).size > MAX_PACKAGE_RESOURCE_BYTES) continue;
      const resource = JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')) as {
        url?: unknown;
        version?: unknown;
      };
      if (typeof resource?.url !== 'string' || typeof resource.version !== 'string') continue;
      if (resource.version.length > 0 && !versions.has(resource.url)) {
        versions.set(resource.url, resource.version);
      }
    } catch {
      // A file that is not a readable resource declares no canonical.
    }
  }
  return versions;
}

export { parsePackageDirName } from './canonical-pin-manifest-candidates.js';
