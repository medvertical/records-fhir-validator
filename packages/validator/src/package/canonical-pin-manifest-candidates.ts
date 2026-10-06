import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
  packageDirectory?: string;
}

export interface UnavailablePackageManifest {
  ref: PackageRef;
  storeRank: number;
  packageDirectory: string;
  unavailableCause: 'manifest-unreadable' | 'manifest-invalid' | 'manifest-identity-mismatch';
}
export type PackageManifestCandidate = InstalledPackageManifest | UnavailablePackageManifest;

const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

/** Required-resolution metadata is checked from actual files; unreadable copies retain their precedence. */
export async function readInstalledManifestCandidates(storeDirs: readonly string[]): Promise<PackageManifestCandidate[]> {
  const candidates: PackageManifestCandidate[] = [];
  for (const [storeRank, storeDir] of storeDirs.entries()) {
    let entries: string[];
    try { entries = (await fs.readdir(storeDir)).sort(); }
    catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (let offset = 0; offset < entries.length; offset += 8) {
      const chunk = await Promise.all(entries.slice(offset, offset + 8).map(entry =>
        readCandidate(storeDir, entry, storeRank)));
      candidates.push(...chunk.filter((candidate): candidate is PackageManifestCandidate => candidate !== null));
    }
  }
  return candidates;
}

async function readCandidate(storeDir: string, entry: string, storeRank: number): Promise<PackageManifestCandidate | null> {
  const ref = parsePackageDirName(entry);
  if (!ref) return null;
  const rootDirectory = path.join(storeDir, entry);
  let packageDirectory = path.join(rootDirectory, 'package');
  try { await fs.stat(packageDirectory); }
  catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') packageDirectory = rootDirectory;
  }
  return readVerifiedPackageManifest(packageDirectory, ref, storeRank);
}

async function readVerifiedPackageManifest(
  packageDirectory: string, ref: PackageRef, storeRank: number,
): Promise<PackageManifestCandidate> {
  const unavailable = (unavailableCause: UnavailablePackageManifest['unavailableCause']): UnavailablePackageManifest =>
    ({ ref, storeRank, packageDirectory, unavailableCause });
  let parsed: unknown;
  try {
    const file = path.join(packageDirectory, 'package.json');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_PACKAGE_INDEX_BYTES) return unavailable('manifest-unreadable');
    const bytes = await fs.readFile(file);
    if (bytes.length > MAX_PACKAGE_INDEX_BYTES) return unavailable('manifest-unreadable');
    parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch { return unavailable('manifest-unreadable'); }
  if (!isManifestRecord(parsed)) return unavailable('manifest-invalid');
  if (parsed.name !== ref.name || parsed.version !== ref.version) return unavailable('manifest-identity-mismatch');
  const rawDependencies = parsed.dependencies;
  if (rawDependencies !== undefined && (!isManifestRecord(rawDependencies)
    || Object.entries(rawDependencies).some(([name, version]) => !name || typeof version !== 'string' || !version))) {
    return unavailable('manifest-invalid');
  }
  if (parsed.fhirVersions !== undefined && (!Array.isArray(parsed.fhirVersions)
    || parsed.fhirVersions.some(version => typeof version !== 'string'))) return unavailable('manifest-invalid');
  return { ref, storeRank, packageDirectory,
    canonical: typeof parsed.canonical === 'string' && parsed.canonical ? parsed.canonical.replace(/\/+$/, '') : null,
    fhirVersions: (parsed.fhirVersions ?? []) as string[],
    dependencies: Object.entries(rawDependencies ?? {}).map(([name, version]) => ({ name, version: version as string })) };
}
function isManifestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePackageDirName(dirName: string): PackageRef | null {
  const separator = dirName.lastIndexOf('#');
  if (separator <= 0 || separator === dirName.length - 1) return null;
  return {
    name: dirName.slice(0, separator),
    version: dirName.slice(separator + 1),
  };
}
