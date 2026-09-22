import type { ReferenceResolver } from '../validators/slicing-validator.js';
import { normalizeFhirReferenceKey } from './fhir-reference-key.js';

type FhirResource = Record<string, unknown>;

interface BundleReferenceIndex {
  fullUrl: Map<string, FhirResource>;
  relative: Map<string, FhirResource>;
  canonical: Map<string, FhirResource>;
  hasEntries: boolean;
}

export type BundleCanonicalResolver = (
  canonical: string,
  resourceType: string,
) => FhirResource | null;

export class BundleReferenceIndexCache {
  private readonly indexes = new WeakMap<Record<string, unknown>, BundleReferenceIndex>();

  get(bundle: Record<string, unknown>): BundleReferenceIndex {
    const cached = this.indexes.get(bundle);
    if (cached) return cached;
    const index = buildBundleReferenceIndex(bundle);
    this.indexes.set(bundle, index);
    return index;
  }
}

export function createBundleReferenceResolver(
  bundle: Record<string, unknown> | undefined,
  rootResource: Record<string, unknown>,
  indexCache: BundleReferenceIndexCache = new BundleReferenceIndexCache(),
): ReferenceResolver | null {
  const contained = Array.isArray(rootResource.contained)
    ? rootResource.contained
    : [];
  const bundleIndex = bundle ? indexCache.get(bundle) : null;

  if (contained.length === 0 && !bundleIndex?.hasEntries) return null;
  const containedById = contained.length > 0
    ? new Map<string, FhirResource>(contained
      .filter((resource): resource is FhirResource =>
        isObjectRecord(resource) && typeof resource.id === 'string'
      )
      .map(resource => [resource.id as string, resource]))
    : null;

  return (reference: string) => {
    if (!reference) return null;

    if (reference.startsWith('#')) {
      const id = reference.slice(1);
      if (id.length === 0) return rootResource;
      return containedById?.get(id) ?? null;
    }

    const relativeKey = normalizeFhirReferenceKey(reference);

    return bundleIndex?.fullUrl.get(reference)
      ?? bundleIndex?.relative.get(reference)
      ?? (relativeKey ? bundleIndex?.relative.get(relativeKey) : null)
      ?? null;
  };
}

/**
 * A canonical (`QuestionnaireResponse.questionnaire`, …) resolves inside the
 * enclosing Bundle before any external lookup: a `urn:uuid:` canonical names
 * an entry's fullUrl, a literal canonical names an entry resource's `url`,
 * and a pinned `|version` has to match the resource's version.
 */
export function createBundleCanonicalResolver(
  bundle: Record<string, unknown> | undefined,
  indexCache: BundleReferenceIndexCache = new BundleReferenceIndexCache(),
): BundleCanonicalResolver | null {
  if (!bundle) return null;
  const index = indexCache.get(bundle);
  if (!index.hasEntries) return null;

  return (canonical, resourceType) => {
    const [base, version] = canonical.split('|');
    if (!base) return null;
    const candidate = index.fullUrl.get(base)
      ?? index.canonical.get(version ? canonical : base)
      ?? index.relative.get(base)
      ?? null;
    if (!candidate || candidate.resourceType !== resourceType) return null;
    return !version || candidate.version === version ? candidate : null;
  };
}

/** Bundle-local and contained lookups win; an external resolver answers what they cannot. */
export function combineReferenceResolvers(
  primary: ReferenceResolver | null,
  fallback?: ReferenceResolver | null,
): ReferenceResolver | null {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;
  return reference => primary(reference) ?? fallback(reference);
}

function buildBundleReferenceIndex(bundle: Record<string, unknown>): BundleReferenceIndex {
  const fullUrl = new Map<string, FhirResource>();
  const relative = new Map<string, FhirResource>();
  const canonical = new Map<string, FhirResource>();
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];

  for (const entry of entries) {
    if (!isObjectRecord(entry) || !isObjectRecord(entry.resource)) continue;
    const resource = entry.resource;

    if (typeof entry.fullUrl === 'string' && !fullUrl.has(entry.fullUrl)) {
      fullUrl.set(entry.fullUrl, resource);
    }

    if (typeof resource.resourceType === 'string' && typeof resource.id === 'string') {
      const key = `${resource.resourceType}/${resource.id}`;
      if (!relative.has(key)) relative.set(key, resource);
    }

    if (typeof resource.url === 'string' && resource.url.length > 0) {
      if (!canonical.has(resource.url)) canonical.set(resource.url, resource);
      if (typeof resource.version === 'string' && resource.version.length > 0) {
        const versioned = `${resource.url}|${resource.version}`;
        if (!canonical.has(versioned)) canonical.set(versioned, resource);
      }
    }
  }

  return {
    fullUrl,
    relative,
    canonical,
    hasEntries: fullUrl.size > 0 || relative.size > 0 || canonical.size > 0,
  };
}

function isObjectRecord(value: unknown): value is FhirResource {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
