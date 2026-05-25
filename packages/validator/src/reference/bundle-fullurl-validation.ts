import type { BundleEntry, BundleIssue } from './bundle-reference-types';

function parseRestfulFullUrlResourceIdentity(fullUrl: string): { resourceType: string; id: string } | null {
  const match = fullUrl.match(/(?:^|\/)([A-Z][a-zA-Z]+)\/([^/?#|]+)$/);
  if (!match) return null;

  return {
    resourceType: match[1],
    id: decodeURIComponent(match[2]),
  };
}

export function validateBundleFullUrls(entries: BundleEntry[]): BundleIssue[] {
  return [
    ...validateFullUrlUniqueness(entries),
    ...validateFullUrlConsistency(entries),
  ];
}

function validateFullUrlUniqueness(entries: BundleEntry[]): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const fullUrlMap = new Map<string, number[]>();

  entries.forEach((entry, index) => {
    if (!entry.fullUrl) return;

    const versionId = entry.resource?.meta?.versionId;
    const key = versionId ? `${entry.fullUrl}|${versionId}` : entry.fullUrl;
    if (!fullUrlMap.has(key)) {
      fullUrlMap.set(key, []);
    }
    fullUrlMap.get(key)!.push(index);
  });

  for (const [keyed, indices] of fullUrlMap.entries()) {
    if (indices.length <= 1) continue;

    const fullUrl = keyed.split('|')[0];
    issues.push({
      severity: 'error',
      code: 'duplicate-bundle-fullurl',
      message: `Duplicate fullUrl '${fullUrl}' found in entries: ${indices.join(', ')}`,
    });
  }

  return issues;
}

function validateFullUrlConsistency(entries: BundleEntry[]): BundleIssue[] {
  const issues: BundleIssue[] = [];

  entries.forEach((entry, index) => {
    if (!entry.fullUrl || !entry.resource) return;
    if (entry.fullUrl.startsWith('urn:uuid:')) return;

    const parsedFullUrlIdentity = parseRestfulFullUrlResourceIdentity(entry.fullUrl);
    if (!parsedFullUrlIdentity) return;

    const resource = entry.resource;
    if (
      resource.id &&
      (parsedFullUrlIdentity.resourceType !== resource.resourceType ||
        parsedFullUrlIdentity.id !== resource.id)
    ) {
      const expectedSuffix = `${resource.resourceType}/${resource.id}`;
      issues.push({
        severity: 'warning',
        code: 'bundle-fullurl-mismatch',
        message: `Entry[${index}] fullUrl '${entry.fullUrl}' does not match resource ${expectedSuffix}`,
        entryIndex: index,
      });
    }
  });

  return issues;
}
