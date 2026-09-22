import type { BundleEntry, BundleIssue } from './bundle-reference-types.js';

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
    if (typeof entry.fullUrl !== 'string' || entry.fullUrl.length === 0) return;

    const meta = toRecord(entry.resource?.meta);
    const versionId = getString(meta, 'versionId');
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
    if (typeof entry.fullUrl !== 'string' || entry.fullUrl.length === 0 || !entry.resource) return;
    if (entry.fullUrl.startsWith('urn:uuid:')) return;

    const parsedFullUrlIdentity = parseRestfulFullUrlResourceIdentity(entry.fullUrl);
    if (!parsedFullUrlIdentity) return;

    const resource = entry.resource;
    const resourceType = getString(resource, 'resourceType');
    const resourceId = getString(resource, 'id');
    if (
      resourceId &&
      (parsedFullUrlIdentity.resourceType !== resourceType ||
        parsedFullUrlIdentity.id !== resourceId)
    ) {
      const expectedSuffix = `${resourceType ?? 'Unknown'}/${resourceId}`;
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}
