import { promises as fs, Dirent } from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { reportUnreadablePackageStore } from '../package/package-store-diagnostics.js';
import {
  readPackageDeclarations,
  type CanonicalDeclaration,
} from './valueset-package-canonical-reader.js';
import {
  canonicalIndexFingerprint,
  clearCanonicalIndexFile,
  readCanonicalIndex,
  writeCanonicalIndex,
  type CanonicalIndexFingerprint,
} from './valueset-canonical-index-store.js';

/**
 * Which packages can hold a given ValueSet or CodeSystem canonical.
 *
 * Without this, a canonical the stores do not have costs a full pass over every
 * installed package — measured at 648 ms against 53 bundled packages, against
 * 26–39 ms for one that is found. The negative cache keeps each canonical from
 * paying twice, but a resource family that touches a dozen unknown canonicals
 * pays seconds before it validates anything.
 *
 * The index answers both cases from one pass: a hit names the one package to
 * read, a miss is an empty set. It is built from the standard `.index.json`
 * where a package ships one and by reading the package's own files where it
 * does not, so a package without an index does not quietly become a package
 * that is always scanned.
 */

export type { CanonicalDeclaration };

const INDEXED_RESOURCE_TYPES = new Set(['ValueSet', 'CodeSystem']);

function bareCanonical(canonical: string): string {
  const separator = canonical.indexOf('|');
  return separator < 0 ? canonical : canonical.slice(0, separator);
}

/** Beyond this the index stops paying for itself and the caller scans instead. */
const MAX_INDEXED_CANONICALS = 200_000;

type BuiltIndex = {
  /** `<resourceType>|<canonical>` to the declarations of it. */
  byCanonical: Map<string, CanonicalDeclaration[]>;
  /** Packages whose contents could not be enumerated; always candidates. */
  opaquePackages: Set<string>;
};

export class PackageCanonicalIndex {
  private signature: string | null = null;
  private building: Promise<BuiltIndex | null> | null = null;
  private index: BuiltIndex | null = null;

  /**
   * The packages that may hold `canonical`, or null when no index could be
   * built — the caller then searches as it did before.
   */
  async packagesFor(
    rootDirectories: readonly string[],
    resourceType: string,
    canonical: string,
  ): Promise<ReadonlySet<string> | null> {
    if (!INDEXED_RESOURCE_TYPES.has(resourceType)) return null;
    const built = await this.ensure(rootDirectories);
    if (!built) return null;

    // Callers ask for `url|version`; the index keys on the bare canonical,
    // because the version is decided by reading the candidates, not by picking
    // the package.
    const declared = built.byCanonical.get(`${resourceType}|${bareCanonical(canonical)}`);
    if (!declared) return built.opaquePackages;
    const packages = new Set(declared.map(declaration => declaration.packageName));
    for (const opaque of built.opaquePackages) packages.add(opaque);
    return packages;
  }

  /**
   * Where each package says the canonical lives. A caller that trusts this can
   * open the one file it needs instead of trying well-known filenames in every
   * package — `CodeSystem-v3-ActCode.json` alone was opened eight times, 1.45 MB
   * each, only to read its `url`.
   *
   * Null when no index covers these stores, or when a package that could not be
   * indexed might also hold the canonical — the caller then searches as before.
   */
  async declarationsFor(
    rootDirectories: readonly string[],
    resourceType: string,
    canonical: string,
  ): Promise<readonly CanonicalDeclaration[] | null> {
    if (!INDEXED_RESOURCE_TYPES.has(resourceType)) return null;
    const built = await this.ensure(rootDirectories);
    if (!built || built.opaquePackages.size > 0) return null;
    return built.byCanonical.get(`${resourceType}|${bareCanonical(canonical)}`) ?? [];
  }

  clear(): void {
    this.signature = null;
    this.index = null;
    this.building = null;
  }

  /** Drops the stored copy as well, for a store that changed under the process. */
  async clearPersisted(rootDirectories: readonly string[]): Promise<void> {
    this.clear();
    await clearCanonicalIndexFile(rootDirectories);
  }

  private async ensure(rootDirectories: readonly string[]): Promise<BuiltIndex | null> {
    const signature = await directorySetSignature(rootDirectories);
    if (signature === null) return null;
    if (this.index && this.signature === signature) return this.index;
    if (this.building && this.signature === signature) return this.building;

    this.signature = signature;
    this.building = loadOrBuildIndex(rootDirectories).then(built => {
      if (this.signature === signature) this.index = built;
      return built;
    }).catch(error => {
      logger.debug('[PackageCanonicalIndex] Index build failed; falling back to a full scan', {
        errorType: error instanceof Error ? 'error' : typeof error,
      });
      if (this.signature === signature) this.signature = null;
      return null;
    });
    return this.building;
  }
}

/**
 * Cheap enough to recompute per lookup — 53 package directories stat in about
 * 0.3 ms — and it is what keeps an installed or replaced package from being
 * answered out of a stale index.
 *
 * Only the packages count. Signing the store's own bookkeeping files would make
 * this index invalidate itself: writing the persisted copy into a store changed
 * the signature that had just been computed, so every process rebuilt once and
 * then re-read the stored file.
 */
async function directorySetSignature(rootDirectories: readonly string[]): Promise<string | null> {
  const parts: string[] = [];
  for (const rootDir of rootDirectories) {
    for (const entry of await readEntries(rootDir, 'PackageCanonicalIndex')) {
      if (!isPackageEntry(entry)) continue;
      const packagePath = path.join(rootDir, entry.name);
      try {
        const stats = await fs.stat(packagePath, { bigint: true });
        parts.push(`${entry.name}:${stats.mtimeNs}:${stats.ino}`);
      } catch {
        return null;
      }
    }
  }
  return parts.length === 0 ? null : parts.sort().join('|');
}

function isPackageEntry(entry: Dirent): boolean {
  return !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink());
}

/**
 * A stored index describes the same packages or it is ignored: building it
 * reads 82 MB across every package, the file is 5.9 MB and parses in 14 ms.
 * Writing it back is best effort — a read-only store just rebuilds each start.
 */
async function loadOrBuildIndex(rootDirectories: readonly string[]): Promise<BuiltIndex | null> {
  let fingerprint: CanonicalIndexFingerprint | null = null;
  try {
    fingerprint = await canonicalIndexFingerprint(rootDirectories);
    const stored = await readCanonicalIndex(rootDirectories, fingerprint);
    if (stored) return stored;
  } catch (error) {
    logger.debug('[PackageCanonicalIndex] Stored index unusable; rebuilding', {
      errorType: error instanceof Error ? 'error' : typeof error,
    });
  }

  const built = await buildIndex(rootDirectories);
  if (built && fingerprint) await writeCanonicalIndex(rootDirectories, fingerprint, built);
  return built;
}

async function buildIndex(rootDirectories: readonly string[]): Promise<BuiltIndex | null> {
  const byCanonical = new Map<string, CanonicalDeclaration[]>();
  const opaquePackages = new Set<string>();
  let canonicals = 0;

  for (const rootDir of rootDirectories) {
    for (const entry of await readEntries(rootDir, 'PackageCanonicalIndex')) {
      const packageRoot = await resolvePackageRoot(rootDir, entry);
      if (!packageRoot) continue;

      const resolved = await readPackageDeclarations(packageRoot, entry.name);
      if (!resolved) {
        opaquePackages.add(entry.name);
        continue;
      }
      for (const [key, declaration] of resolved) {
        const declarations = byCanonical.get(key);
        if (declarations) {
          if (!declares(declarations, declaration)) declarations.push(declaration);
          continue;
        }
        byCanonical.set(key, [declaration]);
        canonicals += 1;
        if (canonicals > MAX_INDEXED_CANONICALS) {
          logger.info('[PackageCanonicalIndex] Store holds more canonicals than the index covers');
          return null;
        }
      }
    }
  }

  if (byCanonical.size === 0) return null;
  return { byCanonical, opaquePackages };
}

/**
 * The bundled store is reachable through a symlinked second root and its
 * packages are installed in `~/.fhir/packages` as well, so one package is
 * enumerated two or three times. The declarations are identical and the reader
 * resolves the package by name across roots, so keeping the repeats only made
 * the stored index three times larger and read the same file three times.
 */
function declares(declarations: CanonicalDeclaration[], candidate: CanonicalDeclaration): boolean {
  return declarations.some(declaration =>
    declaration.packageName === candidate.packageName
    && declaration.filename === candidate.filename
    && declaration.version === candidate.version);
}

async function readEntries(directory: string, operation: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    reportUnreadablePackageStore(operation, directory, error);
    return [];
  }
}

// Dirent.isDirectory() is false for a symlink, and the bundled stores use them.
async function resolvePackageRoot(rootDir: string, entry: Dirent): Promise<string | null> {
  const base = path.join(rootDir, entry.name);
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
  for (const candidate of [path.join(base, 'package'), base]) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch { /* try the next layout */ }
  }
  return null;
}
