/**
 * Records which installed package served a StructureDefinition, keyed by the
 * profile's canonical identity (`url|version`). Dependency pinning needs this
 * later, when a resolved profile's own references are looked up: the pins of
 * the package the profile came from decide which versions its unversioned
 * canonicals resolve to. Keying by canonical identity (not object identity)
 * keeps the provenance valid across the loader's sanitization and caching.
 */
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { parsePackageDirName, type PackageRef } from './canonical-pin-store.js';

const provenanceByCanonical = new BoundedLruCache<string, PackageRef>(2048);

function provenanceKey(url: string, version: string): string {
  return `${url}|${version}`;
}

export function recordProfilePackageProvenance(
  url: string | undefined,
  version: string | undefined,
  packageDirName: string,
): void {
  if (!url || !version) return;
  const ref = parsePackageDirName(packageDirName);
  if (!ref) return;
  provenanceByCanonical.set(provenanceKey(url, version), ref);
}

export function lookupProfilePackageProvenance(
  url: string | undefined,
  version: string | undefined,
): PackageRef | null {
  if (!url || !version) return null;
  return provenanceByCanonical.get(provenanceKey(url, version)) ?? null;
}

export function clearProfilePackageProvenance(): void {
  provenanceByCanonical.clear();
}
