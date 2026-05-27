/**
 * Bundle Reference Resolver
 *
 * Specialized resolver for FHIR Bundle resources that handles internal Bundle references.
 * Supports fullUrl-based resolution, UUID references, and Bundle entry validation.
 * 
 * Task 6.4: Implement Bundle reference resolution (resolve internal references like "#resource-id")
 */

import { extractResourceType as _extractResourceType, parseReference } from './reference-type-extractor';
import {
  extractBundleEntries as extractEntriesFromBundle,
  findAllBundleReferences as findBundleReferences,
} from './bundle-reference-finder';
import { validateBundleFullUrls } from './bundle-fullurl-validation';
import {
  getBundleStatistics,
  getBundleType,
  isTransactionOrBatchBundle,
  validateBundleStructure,
} from './bundle-inspection';
import {
  buildFullUrlIndex,
  findEntryByFullUrl,
  findEntryByResourceTypeAndId,
  getAllBundleResources,
} from './bundle-entry-index';
import type {
  BundleEntry,
  BundleIssue,
  BundleReferenceResolutionResult,
  BundleReference,
  BundleStatistics,
  BundleValidationResult
} from './bundle-reference-types';

// ============================================================================
// Bundle Reference Resolver Class
// ============================================================================

export class BundleReferenceResolver {
  /**
   * Extract all entries from a Bundle resource
   */
  extractBundleEntries(bundle: any): BundleEntry[] {
    return extractEntriesFromBundle(bundle);
  }

  /**
   * Resolve a reference within a Bundle
   */
  resolveBundleReference(
    reference: string,
    bundle: any
  ): BundleReferenceResolutionResult {
    const entries = this.extractBundleEntries(bundle);

    if (entries.length === 0) {
      return {
        resolved: false,
        originalReference: reference,
        errorMessage: 'Bundle has no entries',
      };
    }

    // Parse the reference to understand its format
    const parseResult = parseReference(reference);

    // Try different resolution methods based on reference format

    // 1. Try fullUrl matching (exact match)
    const fullUrlMatch = this.resolveByFullUrl(reference, entries);
    if (fullUrlMatch.resolved) {
      return { ...fullUrlMatch, originalReference: reference, resolutionMethod: 'fullUrl' };
    }

    // 2. Try UUID matching (urn:uuid:...)
    if (reference.startsWith('urn:uuid:')) {
      const uuidMatch = this.resolveByUuid(reference, entries);
      if (uuidMatch.resolved) {
        return { ...uuidMatch, originalReference: reference, resolutionMethod: 'uuid' };
      }
    }

    // 3. Try relative reference matching (ResourceType/id)
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

    // 4. Check if it's a contained reference (would be handled by parent resource)
    if (parseResult.referenceType === 'contained') {
      return {
        resolved: false,
        originalReference: reference,
        errorMessage: 'Contained references should be resolved against parent resource, not Bundle',
        resolutionMethod: 'contained',
      };
    }

    // 5. External reference (not resolvable within Bundle)
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

  /**
   * Resolve reference by matching fullUrl
   */
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

  /**
   * Resolve UUID reference
   */
  private resolveByUuid(reference: string, entries: BundleEntry[]): BundleReferenceResolutionResult {
    // UUID references must match fullUrl exactly
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

  /**
   * Resolve by relative reference (ResourceType/id)
   */
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

      // Also check if fullUrl ends with ResourceType/id
      if (entry.fullUrl && entry.fullUrl.endsWith(`${resourceType}/${resourceId}`)) {
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

  /**
   * Find all references within a Bundle
   */
  findAllBundleReferences(bundle: any): BundleReference[] {
    return findBundleReferences(bundle);
  }

  /**
   * Validate all internal Bundle references
   */
  validateBundleReferences(bundle: any): BundleValidationResult {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      entryIndex?: number;
      reference?: string;
    }> = [];

    const entries = this.extractBundleEntries(bundle);
    const allReferences = this.findAllBundleReferences(bundle);

    // Validate each reference
    const entriesWithIssues = new Set<number>();

    for (const { reference, entryIndex, fieldPath, sourceResourceType: _sourceResourceType } of allReferences) {
      const parseResult = parseReference(reference);

      // Skip external references (absolute URLs and canonical URLs)
      if (parseResult.referenceType === 'absolute' || parseResult.referenceType === 'canonical') {
        continue;
      }

      // Try to resolve internal reference
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
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      totalEntries: entries.length,
      entriesWithIssues: entriesWithIssues.size,
    };
  }

  /**
   * Get all resources from Bundle entries
   */
  getAllBundleResources(bundle: any): any[] {
    return getAllBundleResources(bundle);
  }

  /**
   * Find entry by fullUrl
   */
  findEntryByFullUrl(bundle: any, fullUrl: string): BundleEntry | null {
    return findEntryByFullUrl(bundle, fullUrl);
  }

  /**
   * Find entry by resource type and ID
   */
  findEntryByResourceTypeAndId(bundle: any, resourceType: string, resourceId: string): BundleEntry | null {
    return findEntryByResourceTypeAndId(bundle, resourceType, resourceId);
  }

  /**
   * Build a fullUrl index for fast lookups
   */
  buildFullUrlIndex(bundle: any): Map<string, BundleEntry> {
    return buildFullUrlIndex(bundle);
  }

  /**
   * Validate Bundle entry references using index for performance
   */
  validateBundleReferencesOptimized(bundle: any): BundleValidationResult {
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

    // Only document/message bundles require all references to resolve internally.
    // Other bundle types (collection, searchset, history, transaction, batch)
    // routinely contain references to external resources.
    const bundleType: string | undefined = bundle?.type;
    const isClosedBundle = bundleType === 'document' || bundleType === 'message';

    // Validate each reference
    for (const { reference, entryIndex, fieldPath } of allReferences) {
      const parseResult = parseReference(reference);

      // Skip external references
      if (parseResult.referenceType === 'absolute' || parseResult.referenceType === 'canonical') {
        continue;
      }

      // Skip contained references — `#abc` resolves against the parent
      // resource's contained[] array, not the Bundle index. The
      // contained-reference-resolver enforces that link separately.
      if (parseResult.referenceType === 'contained') {
        continue;
      }

      // Check if reference exists in index
      const exists = fullUrlIndex.has(reference) ||
        (parseResult.resourceType && parseResult.resourceId &&
          fullUrlIndex.has(`${parseResult.resourceType}/${parseResult.resourceId}`));

      if (!exists && (parseResult.referenceType as string) !== 'external') {
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
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      totalEntries: entries.length,
      entriesWithIssues: entriesWithIssues.size,
    };
  }

  /**
   * Check if a Bundle is a transaction or batch Bundle
   */
  isTransactionOrBatchBundle(bundle: any): boolean {
    return isTransactionOrBatchBundle(bundle);
  }

  /**
   * Get Bundle type
   */
  getBundleType(bundle: any): string | null {
    return getBundleType(bundle);
  }

  /**
   * Validate Bundle structure
   */
  validateBundleStructure(bundle: any): BundleIssue[] {
    return validateBundleStructure(bundle);
  }

  /**
   * Extract resource statistics from Bundle
   */
  getBundleStatistics(bundle: any): BundleStatistics {
    return getBundleStatistics(bundle);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bundleResolverInstance: BundleReferenceResolver | null = null;

export function getBundleReferenceResolver(): BundleReferenceResolver {
  if (!bundleResolverInstance) {
    bundleResolverInstance = new BundleReferenceResolver();
  }
  return bundleResolverInstance;
}

export function resetBundleReferenceResolver(): void {
  bundleResolverInstance = null;
}
