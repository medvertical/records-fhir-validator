/**
 * IG-dependency-aware canonical version pinning.
 *
 * When an unversioned canonical exists in several package versions at once
 * (e.g. hl7.fhir.uv.sdc 3.0.0 and 4.0.0), resolution must follow the version
 * the referencing IG was published against, not whichever version happens to
 * be newest in the local store. The pin context captures that IG — the
 * package a validated artifact or a resolved profile comes from — and its
 * declared dependency versions. Pins are applied by rewriting the canonical
 * to `url|resourceVersion`, so the existing versioned resolution paths keep
 * full authority: exact match wins, same-major fallback and the cross-major
 * guard stay intact, and version-qualified cache keys prevent bleed-through.
 */
import {
  CanonicalPinStore,
  type InstalledPackageManifest,
  type PackageRef,
} from './canonical-pin-store.js';

export type { PackageRef } from './canonical-pin-store.js';

export interface CanonicalPinContext {
  /** Package the artifact under validation comes from. */
  source: PackageRef;
  /** Source package first (own IG wins), then dependencies in declared order. */
  pinnedPackages: PackageRef[];
}

interface CanonicalIdentity {
  url: string;
  version: string;
}

/** Canonical resources carry provenance in content; everything else has none. */
function canonicalIdentityOf(resource: unknown): CanonicalIdentity | null {
  if (!resource || typeof resource !== 'object') return null;
  const { url, version } = resource as { url?: unknown; version?: unknown };
  return typeof url === 'string' && url.length > 0
    && typeof version === 'string' && version.length > 0
    ? { url, version }
    : null;
}

const sharedPinStore = new CanonicalPinStore();

export function clearCanonicalPinCaches(): void {
  sharedPinStore.clear();
}

// Core FHIR canonical spaces already resolve through the FHIR-version
// machinery (normalization + version-family preference); pinning them to a
// package release would fight that resolution rather than refine it.
const CORE_CANONICAL_PATTERN =
  /^https?:\/\/hl7\.org\/fhir\/(?:[456]\.\d+(?:\.\d+)?\/)?(?:StructureDefinition|ValueSet|CodeSystem)\//;

const CORE_PACKAGE_PATTERN = /^hl7\.fhir\.r[456][ab]?\.(?:core|examples)$/i;

export function isPinExemptCanonical(canonicalUrl: string): boolean {
  return canonicalUrl.includes('|') || CORE_CANONICAL_PATTERN.test(canonicalUrl);
}

/**
 * Derive the pin context for the artifact being validated. Only canonical
 * resources carry provenance in their content: the owning package is the one
 * whose canonical base contains the artifact's `url` and whose package
 * version equals the artifact's business `version`. Anything weaker (URL
 * heuristics, version-less matches) risks pinning foreign resources, so no
 * context is returned instead.
 */
export async function deriveResourcePinContext(
  storeDirs: readonly string[],
  resource: unknown,
): Promise<CanonicalPinContext | null> {
  const identity = canonicalIdentityOf(resource);
  if (!identity) return null;

  const manifests = await sharedPinStore.listInstalledManifests(storeDirs);
  const owner = selectOwningManifest(manifests, identity.url, identity.version);
  if (!owner) return null;
  return buildPinContext(owner);
}

/** Pin context for a package known to provide an already-resolved profile. */
export async function derivePackagePinContext(
  storeDirs: readonly string[],
  ref: PackageRef,
): Promise<CanonicalPinContext | null> {
  if (CORE_PACKAGE_PATTERN.test(ref.name)) return null;
  const manifests = await sharedPinStore.listInstalledManifests(storeDirs);
  const manifest = manifests.find(
    candidate => candidate.ref.name === ref.name && candidate.ref.version === ref.version,
  );
  return manifest ? buildPinContext(manifest) : null;
}

/**
 * Resolve the resource version an unversioned canonical is pinned to, or
 * null when no pinned package ships it (callers keep current behavior — the
 * pin is soft by construction).
 */
export async function resolvePinnedVersionForCanonical(
  storeDirs: readonly string[],
  context: CanonicalPinContext,
  canonicalUrl: string,
  fhirVersion?: 'R4' | 'R5' | 'R6',
): Promise<string | null> {
  if (isPinExemptCanonical(canonicalUrl)) return null;

  const manifests = await sharedPinStore.listInstalledManifests(storeDirs);
  for (const pin of context.pinnedPackages) {
    if (!pinMatchesFhirVersion(manifests, pin, fhirVersion)) continue;
    const version = await sharedPinStore.findCanonicalResourceVersion(storeDirs, pin, canonicalUrl);
    if (version) return version;
  }
  return null;
}

/**
 * Rewrite an unversioned canonical to the version pinned by the validated
 * artifact's own IG. Returns the canonical unchanged when the artifact has
 * no derivable provenance or no pinned package ships the canonical.
 */
export async function applyResourcePinToCanonical(
  storeDirs: readonly string[],
  resource: unknown,
  canonicalUrl: string,
  fhirVersion?: 'R4' | 'R5' | 'R6',
): Promise<string> {
  if (storeDirs.length === 0 || isPinExemptCanonical(canonicalUrl)) return canonicalUrl;
  const context = await deriveResourcePinContext(storeDirs, resource);
  if (!context) return canonicalUrl;
  const version = await resolvePinnedVersionForCanonical(storeDirs, context, canonicalUrl, fhirVersion);
  return version ? `${canonicalUrl}|${version}` : canonicalUrl;
}

function buildPinContext(owner: InstalledPackageManifest): CanonicalPinContext {
  const pinnedPackages: PackageRef[] = [owner.ref];
  for (const dependency of owner.dependencies) {
    // Core packages are excluded for the same reason as core canonicals; the
    // uv.extensions packages stay because their non-core canonical space is
    // exactly what dependency pins are for.
    if (CORE_PACKAGE_PATTERN.test(dependency.name)) continue;
    pinnedPackages.push(dependency);
  }
  return { source: owner.ref, pinnedPackages };
}

function selectOwningManifest(
  manifests: InstalledPackageManifest[],
  url: string,
  version: string,
): InstalledPackageManifest | null {
  let best: InstalledPackageManifest | null = null;
  for (const manifest of manifests) {
    if (manifest.ref.version !== version) continue;
    if (CORE_PACKAGE_PATTERN.test(manifest.ref.name)) continue;
    if (!manifest.canonical || !url.startsWith(`${manifest.canonical}/`)) continue;
    if (!best || isBetterOwner(manifest, best)) best = manifest;
  }
  return best;
}

/** Longest canonical base wins; then store order; then name, for determinism. */
function isBetterOwner(
  candidate: InstalledPackageManifest,
  current: InstalledPackageManifest,
): boolean {
  const candidateCanonicalLength = candidate.canonical?.length ?? 0;
  const currentCanonicalLength = current.canonical?.length ?? 0;
  if (candidateCanonicalLength !== currentCanonicalLength) {
    return candidateCanonicalLength > currentCanonicalLength;
  }
  if (candidate.storeRank !== current.storeRank) {
    return candidate.storeRank < current.storeRank;
  }
  return candidate.ref.name.localeCompare(current.ref.name) < 0;
}

function pinMatchesFhirVersion(
  manifests: InstalledPackageManifest[],
  pin: PackageRef,
  fhirVersion?: 'R4' | 'R5' | 'R6',
): boolean {
  if (!fhirVersion) return true;
  const manifest = manifests.find(
    candidate => candidate.ref.name === pin.name && candidate.ref.version === pin.version,
  );
  if (!manifest || manifest.fhirVersions.length === 0) return true;
  const majorPrefix = `${fhirVersion.slice(1)}.`;
  return manifest.fhirVersions.some(declared => declared.startsWith(majorPrefix));
}
