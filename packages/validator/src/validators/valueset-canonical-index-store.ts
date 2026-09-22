import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../logger.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';

/**
 * On-disk copy of the terminology canonical index.
 *
 * Building it reads every package index and every file of the packages that
 * ship none — 82 MB and about 750 ms against the stores this repo installs.
 * Serialised the same index is about 5 MB and parses in 14 ms, so a process
 * that finds a valid file skips the whole walk.
 *
 * Identity comes from the package manifests, not from directory mtimes: a
 * container image COPY rewrites mtimes although the package content is
 * immutable, which would make an index built at image time unusable at
 * runtime. This mirrors the profile loader's persistent index.
 */

// v2 records where each canonical lives and at which version, so a lookup
// opens one file instead of trying well-known names in every package.
const INDEX_VERSION = 2;
const INDEX_FILENAME = '.terminology-canonical-index.json';
/** Files an earlier build named after a digest of the store set; see `indexPathsFor`. */
const LEGACY_INDEX_PREFIX = '.terminology-canonical-index-';
const MAX_INDEX_BYTES = 64 * 1024 * 1024;

/** Where one package says a canonical lives, and at which version. */
export type StoredDeclaration = {
  packageName: string;
  filename: string;
  version?: string;
};

export type CanonicalIndexPayload = {
  /** `<resourceType>|<canonical>` to the declarations of it. */
  byCanonical: Map<string, StoredDeclaration[]>;
  /** Packages whose contents could not be enumerated; always candidates. */
  opaquePackages: Set<string>;
};

export type CanonicalIndexFingerprint = Array<{
  root: string;
  packages: Array<{ name: string; manifestHash: string | null }>;
}>;

/**
 * `[packageIndex, filename, version?]`. Written as tuples against a package
 * table because the object form repeated the field names and the full package
 * name for each of 63 000 declarations — 24 MB of file to carry 5 MB of index.
 */
type StoredRow = [number, string, string?];

type PersistedIndex = {
  version: number;
  generatedAt: number;
  roots: CanonicalIndexFingerprint;
  packages: string[];
  canonicals: Record<string, StoredRow[]>;
  opaquePackages: string[];
};

/** The manifest identities of every package under the given roots. */
export async function canonicalIndexFingerprint(
  rootDirectories: readonly string[],
): Promise<CanonicalIndexFingerprint> {
  const roots: CanonicalIndexFingerprint = [];
  for (const root of rootDirectories) {
    const packages: CanonicalIndexFingerprint[number]['packages'] = [];
    let names: string[];
    try {
      names = (await fs.readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
        .map(entry => entry.name)
        .sort();
    } catch {
      roots.push({ root, packages });
      continue;
    }
    for (const name of names) {
      packages.push({ name, manifestHash: await manifestHash(path.join(root, name)) });
    }
    roots.push({ root, packages });
  }
  return roots;
}

async function manifestHash(packageRoot: string): Promise<string | null> {
  for (const candidate of [
    path.join(packageRoot, 'package', 'package.json'),
    path.join(packageRoot, 'package.json'),
  ]) {
    try {
      return createHash('sha256').update(await fs.readFile(candidate)).digest('hex');
    } catch { /* try the other layout */ }
  }
  return null;
}

/** The index a previous process wrote, when it still describes these stores. */
export async function readCanonicalIndex(
  rootDirectories: readonly string[],
  fingerprint: CanonicalIndexFingerprint,
): Promise<CanonicalIndexPayload | null> {
  for (const indexPath of indexPathsFor(rootDirectories)) {
    const payload = await readFrom(indexPath, fingerprint);
    if (payload) return payload;
  }
  return null;
}

async function readFrom(
  indexPath: string,
  fingerprint: CanonicalIndexFingerprint,
): Promise<CanonicalIndexPayload | null> {
  let persisted: PersistedIndex;
  try {
    const stats = await fs.stat(indexPath);
    if (!stats.isFile() || stats.size > MAX_INDEX_BYTES) return null;
    persisted = JSON.parse(await fs.readFile(indexPath, 'utf8')) as PersistedIndex;
  } catch {
    return null;
  }

  if (persisted?.version !== INDEX_VERSION) return null;
  if (!describesTheSameStores(persisted.roots, fingerprint)) {
    logger.debug('[CanonicalIndexStore] Stored index no longer matches the installed packages');
    return null;
  }
  if (!persisted.canonicals || typeof persisted.canonicals !== 'object') return null;
  if (!Array.isArray(persisted.packages)) return null;

  const byCanonical = new Map<string, StoredDeclaration[]>();
  for (const [key, rows] of Object.entries(persisted.canonicals)) {
    if (!Array.isArray(rows)) continue;
    const usable = rows
      .map(row => toDeclaration(row, persisted.packages))
      .filter((declaration): declaration is StoredDeclaration => declaration !== null);
    if (usable.length > 0) byCanonical.set(key, usable);
  }
  if (byCanonical.size === 0) return null;
  return { byCanonical, opaquePackages: new Set(persisted.opaquePackages ?? []) };
}

function toDeclaration(row: unknown, packages: readonly string[]): StoredDeclaration | null {
  if (!Array.isArray(row)) return null;
  const [packageIndex, filename, version] = row as StoredRow;
  const packageName = typeof packageIndex === 'number' ? packages[packageIndex] : undefined;
  if (typeof packageName !== 'string' || packageName.length === 0) return null;
  if (typeof filename !== 'string' || filename.length === 0) return null;
  return {
    packageName,
    filename,
    ...(typeof version === 'string' && version.length > 0 ? { version } : {}),
  };
}

/**
 * Best effort: a read-only store is the normal case for a container image, and
 * one that cannot be written simply rebuilds the index on each start.
 */
export async function writeCanonicalIndex(
  rootDirectories: readonly string[],
  fingerprint: CanonicalIndexFingerprint,
  payload: CanonicalIndexPayload,
): Promise<void> {
  const packages: string[] = [];
  const packageIndices = new Map<string, number>();
  const canonicals: Record<string, StoredRow[]> = {};
  for (const [key, declarations] of payload.byCanonical) {
    canonicals[key] = [...declarations]
      .sort((left, right) =>
        left.packageName.localeCompare(right.packageName) || left.filename.localeCompare(right.filename))
      .map(declaration => {
        let packageIndex = packageIndices.get(declaration.packageName);
        if (packageIndex === undefined) {
          packageIndex = packages.push(declaration.packageName) - 1;
          packageIndices.set(declaration.packageName, packageIndex);
        }
        return declaration.version
          ? [packageIndex, declaration.filename, declaration.version] as StoredRow
          : [packageIndex, declaration.filename] as StoredRow;
      });
  }
  const persisted: PersistedIndex = {
    version: INDEX_VERSION,
    generatedAt: Date.now(),
    roots: fingerprint,
    packages,
    canonicals,
    opaquePackages: [...payload.opaquePackages].sort(),
  };

  const body = JSON.stringify(persisted);
  // The first store may be absent or read-only; any of them will do, since the
  // file names the whole set it describes.
  for (const destination of writableDestinations(rootDirectories)) {
    const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, destination);
      await removeLegacyIndexFiles(path.dirname(destination));
      return;
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      // The store path can carry a home directory or a tenant name, so it is
      // correlated by handle rather than printed.
      const failure = sensitiveValueMetadata(destination);
      const failureCode = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      logger.debug(
        '[CanonicalIndexStore] Could not store the index here; trying the next store',
        { ...failure, failureCode },
      );
    }
  }
}

/** Removes the stored index, so the next lookup rebuilds it. */
export async function clearCanonicalIndexFile(rootDirectories: readonly string[]): Promise<void> {
  for (const indexPath of indexPathsFor(rootDirectories)) {
    await fs.unlink(indexPath).catch(() => undefined);
    await removeLegacyIndexFiles(path.dirname(indexPath));
  }
}

/**
 * Candidate locations, one per store. The first store is often absent or
 * read-only, so every store is a candidate.
 *
 * One file per store, not one per store set: the file states the set it
 * describes and a file describing a different one is rejected on read, so a
 * digest in the name bought nothing and leaked. A run of the test suite left
 * 56 files and 126 MB behind in the bundled store, none of them ever read
 * again. Two different sets now overwrite each other and each rebuilds, which
 * costs a walk and no disk.
 */
function indexPathsFor(rootDirectories: readonly string[]): string[] {
  return rootDirectories.map(root => path.join(root, INDEX_FILENAME));
}

/**
 * An index describing a temporary store can never be read back: that directory
 * is gone next start, so the stored set no longer matches. Writing it into a
 * lasting store would only replace the file the lasting stores can still use —
 * a test that adds a temporary store left 56 such files, 126 MB, in the
 * bundled store. Such an index is kept among the temporary stores or nowhere.
 */
function writableDestinations(rootDirectories: readonly string[]): string[] {
  const eligible = rootDirectories.some(isTemporaryDirectory)
    ? rootDirectories.filter(isTemporaryDirectory)
    : rootDirectories;
  return indexPathsFor(eligible);
}

function isTemporaryDirectory(directory: string): boolean {
  const temporaryRoot = path.resolve(os.tmpdir());
  const candidate = path.resolve(directory);
  return candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${path.sep}`);
}

/**
 * Removes the digest-named files earlier builds left behind. Best effort: the
 * index is rebuilt from the packages, so losing one costs a walk.
 */
async function removeLegacyIndexFiles(directory: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(LEGACY_INDEX_PREFIX) || !name.endsWith('.json')) continue;
    await fs.unlink(path.join(directory, name)).catch(() => undefined);
  }
}

function describesTheSameStores(
  stored: CanonicalIndexFingerprint | undefined,
  current: CanonicalIndexFingerprint,
): boolean {
  if (!Array.isArray(stored) || stored.length !== current.length) return false;
  return current.every((root, index) => {
    const storedRoot = stored[index];
    if (!storedRoot || storedRoot.root !== root.root) return false;
    if (!Array.isArray(storedRoot.packages)) return false;
    if (storedRoot.packages.length !== root.packages.length) return false;
    return root.packages.every((pkg, position) =>
      storedRoot.packages[position]?.name === pkg.name
      && storedRoot.packages[position]?.manifestHash === pkg.manifestHash);
  });
}
