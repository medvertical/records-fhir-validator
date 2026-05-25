import { parseReference } from './reference-type-extractor';
import {
  extractBundleEntries,
  findAllBundleReferences,
} from './bundle-reference-finder';
import type { BundleIssue, BundleStatistics } from './bundle-reference-types';

export function isTransactionOrBatchBundle(bundle: any): boolean {
  return bundle?.type === 'transaction' || bundle?.type === 'batch';
}

export function getBundleType(bundle: any): string | null {
  return bundle?.type || null;
}

export function validateBundleStructure(bundle: any): BundleIssue[] {
  const issues: BundleIssue[] = [];

  if (!bundle.type) {
    issues.push({
      severity: 'error',
      code: 'bundle-missing-type',
      message: 'Bundle.type is required',
    });
  }

  if (!bundle.entry) {
    issues.push({
      severity: 'warning',
      code: 'bundle-missing-entries',
      message: 'Bundle has no entries array',
    });
  } else if (!Array.isArray(bundle.entry)) {
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

export function getBundleStatistics(bundle: any): BundleStatistics {
  const entries = extractBundleEntries(bundle);
  const allReferences = findAllBundleReferences(bundle);
  const resourceTypes: Record<string, number> = {};

  entries.forEach(entry => {
    if (entry.resource?.resourceType) {
      const type = entry.resource.resourceType;
      resourceTypes[type] = (resourceTypes[type] || 0) + 1;
    }
  });

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

function addTransactionEntryIssues(bundle: any, issues: BundleIssue[]): void {
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
      });
    }

    if (!entry.request.url) {
      issues.push({
        severity: 'error',
        code: 'bundle-request-missing-url',
        message: `Entry[${index}] request missing required 'url'`,
      });
    }
  });
}
