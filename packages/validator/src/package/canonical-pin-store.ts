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

export interface PackageRef {
  name: string;
  version: string;
}

export interface InstalledPackageManifest {
  ref: PackageRef;
  canonical: string | null;
  fhirVersions: string[];
  dependencies: PackageRef[];
  storeRank: number;
}

// Package indexes above this size are skipped: parsing them on the hot path
// costs more than the pin precision they would add, mirroring the guard in
// the ValueSet package search.
const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

interface CachedStoreManifests {
  signature: string;
  promise: Promise<InstalledPackageManifest[]>;
}

interface CachedCanonicalVersions {
  signature: string;
  promise: Promise<Map<string, string> | null>;
}

export class CanonicalPinStore {
  private readonly storeManifests = new BoundedLruCache<string, CachedStoreManifests>(16);
  private readonly canonicalVersions = new BoundedLruCache<string, CachedCanonicalVersions>(128);

  /** Installed package manifests across the given stores, in store order. */
  async listInstalledManifests(storeDirs: readonly string[]): Promise<InstalledPackageManifest[]> {
    const manifests: InstalledPackageManifest[] = [];
    for (const [storeRank, storeDir] of storeDirs.entries()) {
      manifests.push(...await this.listStoreManifests(storeDir, storeRank));
    }
    return manifests;
  }

  /**
   * Resource version of `canonicalUrl` inside the exact installed package
   * `ref`, or null when the package is absent or does not ship the canonical.
   */
  async findCanonicalResourceVersion(
    storeDirs: readonly string[],
    ref: PackageRef,
    canonicalUrl: string,
  ): Promise<string | null> {
    for (const storeDir of storeDirs) {
      const packagePath = path.join(storeDir, `${ref.name}#${ref.version}`, 'package');
      const versions = await this.loadCanonicalVersions(packagePath);
      if (!versions) continue;
      const version = versions.get(canonicalUrl);
      if (version) return version;
      // The package is installed here but does not ship this canonical —
      // other stores hold other packages, not other content for this ref.
      return null;
    }
    return null;
  }

  clear(): void {
    this.storeManifests.clear();
    this.canonicalVersions.clear();
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

export function parsePackageDirName(dirName: string): PackageRef | null {
  const separator = dirName.lastIndexOf('#');
  if (separator <= 0 || separator === dirName.length - 1) return null;
  return {
    name: dirName.slice(0, separator),
    version: dirName.slice(separator + 1),
  };
}
