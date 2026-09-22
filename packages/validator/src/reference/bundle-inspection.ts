import { parseReference } from './reference-type-extractor.js';
import {
  extractBundleEntries,
  findAllBundleReferences,
} from './bundle-reference-finder.js';
import type { BundleIssue, BundleStatistics } from './bundle-reference-types.js';

export function isTransactionOrBatchBundle(bundle: unknown): boolean {
  const type = getBundleType(bundle);
  return type === 'transaction' || type === 'batch';
}

export function getBundleType(bundle: unknown): string | null {
  const value = toRecord(bundle)?.type;
  return typeof value === 'string' ? value : null;
}

export function validateBundleStructure(bundle: unknown): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const bundleRecord = toRecord(bundle);

  if (!getBundleType(bundle)) {
    issues.push({
      severity: 'error',
      code: 'bundle-missing-type',
      message: 'Bundle.type is required',
    });
  }

  if (bundleRecord?.entry !== undefined && !Array.isArray(bundleRecord.entry)) {
    issues.push({
      severity: 'error',
      code: 'bundle-invalid-entries',
      message: 'Bundle.entry must be an array',
    });
  }

  if (isTransactionOrBatchBundle(bundle)) {
    addTransactionEntryIssues(bundle, issues);
  }

  return issues;
}

export function getBundleStatistics(bundle: unknown): BundleStatistics {
  const entries = extractBundleEntries(bundle);
  const allReferences = findAllBundleReferences(bundle);
  const resourceTypeCounts = new Map<string, number>();

  entries.forEach(entry => {
    if (entry.resource?.resourceType) {
      const type = String(entry.resource.resourceType);
      resourceTypeCounts.set(type, (resourceTypeCounts.get(type) ?? 0) + 1);
    }
  });

  const resourceTypes = Object.fromEntries(resourceTypeCounts);

  return {
    totalEntries: entries.length,
    resourceTypes,
    hasFullUrls: entries.filter(entry => entry.fullUrl).length,
    hasUuidReferences: allReferences.filter(ref => ref.reference.startsWith('urn:uuid:')).length,
    hasRelativeReferences: allReferences.filter(ref => parseReference(ref.reference).referenceType === 'relative').length,
    hasExternalReferences: allReferences.filter(ref => {
      const parsed = parseReference(ref.reference);
      return parsed.referenceType === 'absolute' || parsed.referenceType === 'canonical';
    }).length,
  };
}

function addTransactionEntryIssues(bundle: unknown, issues: BundleIssue[]): void {
  const entries = extractBundleEntries(bundle);

  entries.forEach((entry, index) => {
    if (!entry.request) {
      issues.push({
        severity: 'error',
        code: 'bundle-entry-missing-request',
        message: `Transaction/batch Bundle entry[${index}] missing required 'request' element`,
      });
      return;
    }

    if (!entry.request.method) {
      issues.push({
        severity: 'error',
        code: 'bundle-request-missing-method',
        message: `Entry[${index}] request missing required 'method'`,
        path: `Bundle.entry[${index}].request.method`,
        entryIndex: index,
      });
    }

    if (!entry.request.url) {
      issues.push({
        severity: 'error',
        code: 'bundle-request-missing-url',
        message: `Entry[${index}] request missing required 'url'`,
        path: `Bundle.entry[${index}].request.url`,
        entryIndex: index,
      });
    }
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
