import { extractBundleEntries } from './bundle-reference-finder';
import type { BundleEntry } from './bundle-reference-types';

export function getAllBundleResources(bundle: any): any[] {
  return extractBundleEntries(bundle)
    .filter(entry => entry.resource)
    .map(entry => entry.resource);
}

export function findEntryByFullUrl(bundle: any, fullUrl: string): BundleEntry | null {
  return extractBundleEntries(bundle).find(entry => entry.fullUrl === fullUrl) || null;
}

export function findEntryByResourceTypeAndId(
  bundle: any,
  resourceType: string,
  resourceId: string
): BundleEntry | null {
  return extractBundleEntries(bundle).find(entry =>
    entry.resource?.resourceType === resourceType &&
    entry.resource?.id === resourceId
  ) || null;
}

export function buildFullUrlIndex(bundle: any): Map<string, BundleEntry> {
  const index = new Map<string, BundleEntry>();

  extractBundleEntries(bundle).forEach(entry => {
    if (entry.fullUrl) {
      index.set(entry.fullUrl, entry);
    }

    if (entry.resource?.resourceType && entry.resource?.id) {
      const relativeUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
      index.set(relativeUrl, entry);
    }
  });

  return index;
}
