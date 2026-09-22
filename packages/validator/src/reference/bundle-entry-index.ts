import { extractBundleEntries } from './bundle-reference-finder.js';
import type { BundleEntry, FhirResourceRecord } from './bundle-reference-types.js';

export function getAllBundleResources(bundle: unknown): FhirResourceRecord[] {
  return extractBundleEntries(bundle)
    .flatMap(entry => entry.resource ? [entry.resource] : []);
}

export function findEntryByFullUrl(bundle: unknown, fullUrl: string): BundleEntry | null {
  return extractBundleEntries(bundle).find(entry => entry.fullUrl === fullUrl) || null;
}

export function findEntryByResourceTypeAndId(
  bundle: unknown,
  resourceType: string,
  resourceId: string
): BundleEntry | null {
  return extractBundleEntries(bundle).find(entry =>
    getString(entry.resource, 'resourceType') === resourceType &&
    getString(entry.resource, 'id') === resourceId
  ) || null;
}

export function buildFullUrlIndex(bundle: unknown): Map<string, BundleEntry> {
  const index = new Map<string, BundleEntry>();

  extractBundleEntries(bundle).forEach(entry => {
    if (entry.fullUrl) {
      index.set(entry.fullUrl, entry);
    }

    const resourceType = getString(entry.resource, 'resourceType');
    const resourceId = getString(entry.resource, 'id');
    if (resourceType && resourceId) {
      const relativeUrl = `${resourceType}/${resourceId}`;
      index.set(relativeUrl, entry);
    }
  });

  return index;
}

function getString(resource: FhirResourceRecord | undefined, key: string): string | undefined {
  const value = resource?.[key];
  return typeof value === 'string' ? value : undefined;
}
