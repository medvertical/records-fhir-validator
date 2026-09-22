/**
 * Specialized resolver for FHIR Bundle resources that handles internal Bundle references.
 * Supports fullUrl-based resolution, UUID references, and Bundle entry validation.
 */

import { extractResourceType as _extractResourceType, parseReference } from './reference-type-extractor.js';
import { isErrorValidationSeverity } from '@records-fhir/validation-types';
import {
  extractBundleEntries as extractEntriesFromBundle,
  findAllBundleReferences as findBundleReferences,
} from './bundle-reference-finder.js';
import { validateBundleFullUrls } from './bundle-fullurl-validation.js';
import {
  getBundleStatistics,
  getBundleType,
  isTransactionOrBatchBundle,
  validateBundleStructure,
} from './bundle-inspection.js';
import {
  buildFullUrlIndex,
  findEntryByFullUrl,
  findEntryByResourceTypeAndId,
  getAllBundleResources,
} from './bundle-entry-index.js';
import type {
  BundleEntry,
  BundleIssue,
  BundleReferenceResolutionResult,
  BundleReference,
  BundleStatistics,
  BundleValidationResult,
  FhirResourceRecord,
} from './bundle-reference-types.js';

export class BundleReferenceResolver {
  extractBundleEntries(bundle: unknown): BundleEntry[] {
    return extractEntriesFromBundle(bundle);
  }

  resolveBundleReference(
    reference: string,
    bundle: unknown
  ): BundleReferenceResolutionResult {
    const entries = this.extractBundleEntries(bundle);

    if (entries.length === 0) {
      return {
        resolved: false,
        originalReference: reference,
        errorMessage: 'Bundle has no entries',
      };
    }

    const parseResult = parseReference(reference);

    const fullUrlMatch = this.resolveByFullUrl(reference, entries);
    if (fullUrlMatch.resolved) {
      return { ...fullUrlMatch, originalReference: reference, resolutionMethod: 'fullUrl' };
    }

    if (reference.startsWith('urn:uuid:')) {
      const uuidMatch = this.resolveByUuid(reference, entries);
      if (uuidMatch.resolved) {
        return { ...uuidMatch, originalReference: reference, resolutionMethod: 'uuid' };
      }
    }

    if (parseResult.referenceType === 'relative' && parseResult.resourceType && parseResult.resourceId) {
      const relativeMatch = this.resolveByRelativeReference(
        parseResult.resourceType,
        parseResult.resourceId,
        entries
      );
      if (relativeMatch.resolved) {
        return { ...relativeMatch, originalReference: reference, resolutionMethod: 'relative' };
      }
    }

    if (parseResult.referenceType === 'contained') {
      return {
        resolved: false,
        originalReference: reference,
        errorMessage: 'Contained references should be resolved against parent resource, not Bundle',
        resolutionMethod: 'contained',
      };
    }

    if (parseResult.referenceType === 'absolute' || parseResult.referenceType === 'canonical') {
      return {
        resolved: false,
        originalReference: reference,
        errorMessage: 'External references cannot be resolved within Bundle',
        resolutionMethod: 'external',
      };
    }

    return {
      resolved: false,
      originalReference: reference,
      errorMessage: `Reference '${reference}' not found in Bundle entries`,
    };
  }

  private resolveByFullUrl(reference: string, entries: BundleEntry[]): BundleReferenceResolutionResult {
    for (const entry of entries) {
      if (entry.fullUrl === reference && entry.resource) {
        return {
          resolved: true,
          resource: entry.resource,
          entry,
          originalReference: reference,
        };
      }
    }

    return {
      resolved: false,
      originalReference: reference,
    };
  }

  private resolveByUuid(reference: string, entries: BundleEntry[]): BundleReferenceResolutionResult {
    for (const entry of entries) {
      if (entry.fullUrl === reference && entry.resource) {
        return {
          resolved: true,
          resource: entry.resource,
          entry,
          originalReference: reference,
        };
      }
    }

    return {
      resolved: false,
      originalReference: reference,
    };
  }

  private resolveByRelativeReference(
    resourceType: string,
    resourceId: string,
    entries: BundleEntry[]
  ): BundleReferenceResolutionResult {
    for (const entry of entries) {
      const resource = entry.resource;

      if (resource &&
        resource.resourceType === resourceType &&
        resource.id === resourceId) {
        return {
          resolved: true,
          resource,
          entry,
          originalReference: `${resourceType}/${resourceId}`,
        };
      }

      if (resource && entry.fullUrl && entry.fullUrl.endsWith(`${resourceType}/${resourceId}`)) {
        return {
          resolved: true,
          resource,
          entry,
          originalReference: `${resourceType}/${resourceId}`,
        };
      }
    }

    return {
      resolved: false,
      originalReference: `${resourceType}/${resourceId}`,
    };
  }

  findAllBundleReferences(bundle: unknown): BundleReference[] {
    return findBundleReferences(bundle);
  }

  validateBundleReferences(bundle: unknown): BundleValidationResult {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      entryIndex?: number;
      reference?: string;
    }> = [];

    const entries = this.extractBundleEntries(bundle);
    const allReferences = this.findAllBundleReferences(bundle);

    const entriesWithIssues = new Set<number>();

    for (const { reference, entryIndex, fieldPath, sourceResourceType: _sourceResourceType } of allReferences) {
      const parseResult = parseReference(reference);

      if (parseResult.referenceType === 'absolute' || parseResult.referenceType === 'canonical') {
        continue;
      }

      const resolution = this.resolveBundleReference(reference, bundle);

      if (!resolution.resolved && resolution.resolutionMethod !== 'external') {
        issues.push({
          severity: 'error',
          code: 'unresolved-bundle-reference',
          message: `Reference '${reference}' in entry[${entryIndex}].${fieldPath} cannot be resolved within Bundle`,
          entryIndex,
          reference,
        });
        entriesWithIssues.add(entryIndex);
      }
    }

    issues.push(...validateBundleFullUrls(entries));

    return {
      isValid: !issues.some(i => isErrorValidationSeverity(i.severity)),
      issues,
      totalEntries: entries.length,
      entriesWithIssues: entriesWithIssues.size,
    };
  }

  getAllBundleResources(bundle: unknown): FhirResourceRecord[] {
    return getAllBundleResources(bundle);
  }

  findEntryByFullUrl(bundle: unknown, fullUrl: string): BundleEntry | null {
    return findEntryByFullUrl(bundle, fullUrl);
  }

  findEntryByResourceTypeAndId(bundle: unknown, resourceType: string, resourceId: string): BundleEntry | null {
    return findEntryByResourceTypeAndId(bundle, resourceType, resourceId);
  }

  buildFullUrlIndex(bundle: unknown): Map<string, BundleEntry> {
    return buildFullUrlIndex(bundle);
  }

  validateBundleReferencesOptimized(bundle: unknown): BundleValidationResult {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      entryIndex?: number;
      reference?: string;
    }> = [];

    const entries = this.extractBundleEntries(bundle);
    const fullUrlIndex = this.buildFullUrlIndex(bundle);
    const allReferences = this.findAllBundleReferences(bundle);
    const entriesWithIssues = new Set<number>();

    const bundleType = this.getBundleType(bundle);
    const isClosedBundle = bundleType === 'document' || bundleType === 'message';

    for (const { reference, entryIndex, fieldPath } of allReferences) {
      const parseResult = parseReference(reference);

      if (parseResult.referenceType === 'absolute' || parseResult.referenceType === 'canonical') {
        continue;
      }

      if (parseResult.referenceType === 'contained') {
        continue;
      }

      const exists = fullUrlIndex.has(reference) ||
        (parseResult.resourceType && parseResult.resourceId &&
          fullUrlIndex.has(`${parseResult.resourceType}/${parseResult.resourceId}`));

      const shouldReportUnresolved =
        isClosedBundle ||
        reference.startsWith('urn:uuid:') ||
        reference.startsWith('urn:oid:');

      if (shouldReportUnresolved && !exists && (parseResult.referenceType as string) !== 'external') {
        issues.push({
          severity: isClosedBundle ? 'error' : 'warning',
          code: 'unresolved-bundle-reference',
          message: `Reference '${reference}' in entry[${entryIndex}].${fieldPath} not found in Bundle`,
          entryIndex,
          reference,
        });
        entriesWithIssues.add(entryIndex);
      }
    }

    issues.push(...validateBundleFullUrls(entries));

    return {
      isValid: !issues.some(i => isErrorValidationSeverity(i.severity)),
      issues,
      totalEntries: entries.length,
      entriesWithIssues: entriesWithIssues.size,
    };
  }

  isTransactionOrBatchBundle(bundle: unknown): boolean {
    return isTransactionOrBatchBundle(bundle);
  }

  getBundleType(bundle: unknown): string | null {
    return getBundleType(bundle);
  }

  validateBundleStructure(bundle: unknown): BundleIssue[] {
    return validateBundleStructure(bundle);
  }

  getBundleStatistics(bundle: unknown): BundleStatistics {
    return getBundleStatistics(bundle);
  }
}

export function getBundleReferenceResolver(): BundleReferenceResolver {
  return new BundleReferenceResolver();
}

export function resetBundleReferenceResolver(): void {
  // Compatibility no-op: resolver instances are caller-owned.
}
