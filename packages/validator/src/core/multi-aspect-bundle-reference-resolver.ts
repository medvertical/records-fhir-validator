import type { ReferenceResolver } from '../validators/slicing-validator';

const bundleReferenceIndexCache = new WeakMap<Record<string, unknown>, BundleReferenceIndex>();

interface BundleReferenceIndex {
  fullUrl: Map<string, any>;
  relative: Map<string, any>;
  hasEntries: boolean;
}

export function createBundleReferenceResolver(
  bundle: Record<string, unknown> | undefined,
  rootResource: Record<string, unknown>,
): ReferenceResolver | null {
  const contained = Array.isArray((rootResource as any).contained)
    ? (rootResource as any).contained
    : [];
  const bundleIndex = bundle ? getBundleReferenceIndex(bundle) : null;

  if (contained.length === 0 && !bundleIndex?.hasEntries) return null;
  const containedById = contained.length > 0
    ? new Map(contained
      .filter((resource: any) => typeof resource?.id === 'string')
      .map((resource: any) => [resource.id, resource]))
    : null;

  return (reference: string) => {
    if (!reference) return null;

    if (reference.startsWith('#')) {
      const id = reference.slice(1);
      return containedById?.get(id) ?? null;
    }

    return bundleIndex?.fullUrl.get(reference)
      ?? bundleIndex?.relative.get(reference)
      ?? null;
  };
}

function getBundleReferenceIndex(bundle: Record<string, unknown>): BundleReferenceIndex {
  const cached = bundleReferenceIndexCache.get(bundle);
  if (cached) return cached;

  const fullUrl = new Map<string, any>();
  const relative = new Map<string, any>();
  const entries = Array.isArray((bundle as any).entry) ? (bundle as any).entry : [];

  for (const entry of entries) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') continue;

    if (typeof entry.fullUrl === 'string' && !fullUrl.has(entry.fullUrl)) {
      fullUrl.set(entry.fullUrl, resource);
    }

    if (typeof resource.resourceType === 'string' && typeof resource.id === 'string') {
      const key = `${resource.resourceType}/${resource.id}`;
      if (!relative.has(key)) relative.set(key, resource);
    }
  }

  const index = { fullUrl, relative, hasEntries: fullUrl.size > 0 || relative.size > 0 };
  bundleReferenceIndexCache.set(bundle, index);
  return index;
}
