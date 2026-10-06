import { compareVersions } from '../package-resolver/version-comparator.js';
import type { InstalledPackageManifest, PackageManifestCandidate, PackageRef } from './canonical-pin-store.js';

const MAX_CLOSURE_PACKAGES = 64;

/** A literal is exact; only an explicit short version or patch wildcard selects a range. */
export function selectStandInRelease(installedVersions: readonly string[], declaredVersion: string): string | null {
  if (installedVersions.includes(declaredVersion)) return declaredVersion;
  const range = /^(\d+)(?:\.(\d+)(?:\.[xX*])?)?$/.exec(declaredVersion);
  if (!range) return null;
  const prefix = range[2] === undefined ? `${Number(range[1])}.` : `${Number(range[1])}.${Number(range[2])}.`;
  return installedVersions.filter(version => version.startsWith(prefix)
    && /^\d+\.\d+\.\d+$/.test(version)).sort(compareVersions).at(-1) ?? null;
}

export type DependencyClosureEntry =
  | { status: 'available'; manifest: InstalledPackageManifest }
  | { status: 'unavailable'; ref: PackageRef; cause: 'source-missing' | 'dependency-missing' | 'closure-limit' | 'manifest-unreadable' | 'manifest-invalid' | 'manifest-identity-mismatch' };

/** Opaque branches retain their BFS position; later content cannot prove an earlier branch absent. */
export function dependencyClosureEntries(
  manifests: readonly PackageManifestCandidate[], source: PackageRef,
  packageVersionPins: Readonly<Record<string, string>>, isExcludedDependency: (name: string) => boolean,
): DependencyClosureEntry[] {
  const releasesByName = new Map<string, Map<string, PackageManifestCandidate>>();
  for (const manifest of manifests) {
    const releases = releasesByName.get(manifest.ref.name) ?? new Map();
    if (!releases.has(manifest.ref.version)) releases.set(manifest.ref.version, manifest);
    releasesByName.set(manifest.ref.name, releases);
  }
  const first = releasesByName.get(source.name)?.get(source.version);
  if (!first) return [{ status: 'unavailable', ref: source, cause: 'source-missing' }];
  if ('unavailableCause' in first) return [{ status: 'unavailable', ref: source, cause: first.unavailableCause }];
  const entries: DependencyClosureEntry[] = [{ status: 'available', manifest: first }];
  const visited = new Set([`${source.name}#${source.version}`]);
  let availableCount = 1;
  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position];
    if (entry.status !== 'available') continue;
    for (const dependency of entry.manifest.dependencies) {
      if (isExcludedDependency(dependency.name)) continue;
      const releases = releasesByName.get(dependency.name);
      const version = Object.hasOwn(packageVersionPins, dependency.name)
        ? packageVersionPins[dependency.name] : selectStandInRelease([...releases?.keys() ?? []], dependency.version);
      const ref = { name: dependency.name, version: version ?? dependency.version };
      const key = `${ref.name}#${ref.version}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const manifest = version ? releases?.get(version) : undefined;
      if (!manifest) {
        entries.push({ status: 'unavailable', ref, cause: 'dependency-missing' });
        if (entries.length > MAX_CLOSURE_PACKAGES) return entries;
      }
      else if ('unavailableCause' in manifest) {
        entries.push({ status: 'unavailable', ref, cause: manifest.unavailableCause });
        if (entries.length > MAX_CLOSURE_PACKAGES) return entries;
      }
      else if (availableCount >= MAX_CLOSURE_PACKAGES || entries.length >= MAX_CLOSURE_PACKAGES) {
        entries.push({ status: 'unavailable', ref, cause: 'closure-limit' });
        return entries;
      }
      else { availableCount++; entries.push({ status: 'available', manifest }); }
    }
  }
  return entries;
}

/** Compatibility projection; authority-sensitive callers consume entries including unavailable branches. */
export function buildDependencyClosure(
  manifests: readonly InstalledPackageManifest[], source: PackageRef,
  pins: Readonly<Record<string, string>>, excluded: (name: string) => boolean,
): PackageRef[] {
  return dependencyClosureEntries(manifests, source, pins, excluded)
    .flatMap(entry => entry.status === 'available' ? [entry.manifest.ref] : []);
}
