/* eslint-disable max-lines */
/**
 * Bundle Reference Resolver
 *
 * Specialized resolver for FHIR Bundle resources that handles internal Bundle references.
 * Supports fullUrl-based resolution, UUID references, and Bundle entry validation.
 * 
 * Task 6.4: Implement Bundle reference resolution (resolve internal references like "#resource-id")
 */

import { extractResourceType as _extractResourceType, parseReference } from './reference-type-extractor';
import type {
  BundleEntry,
  BundleReferenceResolutionResult,
  BundleValidationResult
} from './bundle-reference-types';

// Re-export types for backwards compatibility
export type { BundleEntry, BundleReferenceResolutionResult, BundleValidationResult };

// ============================================================================
// Bundle Reference Resolver Class
// ============================================================================

export class BundleReferenceResolver {
  /**
   * Extract all entries from a Bundle resource
   */
  extractBundleEntries(bundle: any): BundleEntry[] {
    if (!bundle || bundle.resourceType !== 'Bundle') {
      return [];
    }

    if (!bundle.entry || !Array.isArray(bundle.entry)) {
      return [];
    }

    return bundle.entry;
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
  findAllBundleReferences(bundle: any): Array<{
    reference: string;
    entryIndex: number;
    fieldPath: string;
    sourceResourceType?: string;
  }> {
    const references: Array<{
      reference: string;
      entryIndex: number;
      fieldPath: string;
      sourceResourceType?: string;
    }> = [];

    const entries = this.extractBundleEntries(bundle);

    entries.forEach((entry, index) => {
      if (entry.resource) {
        const resourceRefs = this.findReferencesInResource(entry.resource);
        resourceRefs.forEach(ref => {
          references.push({
            ...ref,
            entryIndex: index,
            sourceResourceType: entry.resource?.resourceType,
          });
        });
      }
    });

    return references;
  }

  /**
   * Find all references in a single resource
   */
  private findReferencesInResource(resource: any, fieldPath: string = ''): Array<{
    reference: string;
    fieldPath: string;
  }> {
    const references: Array<{ reference: string; fieldPath: string }> = [];

    if (!resource || typeof resource !== 'object') {
      return references;
    }

    // Check if this is a reference object
    if (resource.reference && typeof resource.reference === 'string') {
      references.push({
        reference: resource.reference,
        fieldPath: fieldPath ? `${fieldPath}.reference` : 'reference',
      });
    }

    // Recursively check all properties
    for (const [key, value] of Object.entries(resource)) {
      if (key === 'contained') {
        // Skip contained array to avoid confusion with Bundle entries
        continue;
      }

      const newPath = fieldPath ? `${fieldPath}.${key}` : key;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          references.push(...this.findReferencesInResource(item, `${newPath}[${index}]`));
        });
      } else if (value && typeof value === 'object') {
        references.push(...this.findReferencesInResource(value, newPath));
      }
    }

    return references;
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

    // Validate fullUrl uniqueness
    const fullUrlIssues = this.validateFullUrlUniqueness(entries);
    issues.push(...fullUrlIssues);

    // Validate fullUrl consistency with resource
    const consistencyIssues = this.validateFullUrlConsistency(entries);
    issues.push(...consistencyIssues);

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      totalEntries: entries.length,
      entriesWithIssues: entriesWithIssues.size,
    };
  }

  /**
   * Validate that fullUrl values are unique within Bundle
   */
  private validateFullUrlUniqueness(entries: BundleEntry[]): Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    entryIndex?: number;
  }> {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      entryIndex?: number;
    }> = [];

    // Entries with distinct `meta.versionId` are legitimately separate
    // snapshots of the same logical resource (see FHIR R4 document-bundle
    // rules around versioned references), so key on fullUrl+versionId.
    // Entries without a versionId collide only with each other.
    const fullUrlMap = new Map<string, number[]>();

    entries.forEach((entry, index) => {
      if (entry.fullUrl) {
        const versionId = entry.resource?.meta?.versionId;
        const key = versionId ? `${entry.fullUrl}|${versionId}` : entry.fullUrl;
        if (!fullUrlMap.has(key)) {
          fullUrlMap.set(key, []);
        }
        fullUrlMap.get(key)!.push(index);
      }
    });

    // Check for duplicates
    for (const [keyed, indices] of fullUrlMap.entries()) {
      if (indices.length > 1) {
        // Strip the "|version" suffix back out of the key for reporting.
        const fullUrl = keyed.split('|')[0];
        issues.push({
          severity: 'error',
          code: 'duplicate-bundle-fullurl',
          message: `Duplicate fullUrl '${fullUrl}' found in entries: ${indices.join(', ')}`,
        });
      }
    }

    return issues;
  }

  /**
   * Validate that fullUrl is consistent with resource type and ID
   */
  private validateFullUrlConsistency(entries: BundleEntry[]): Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    entryIndex?: number;
  }> {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      entryIndex?: number;
    }> = [];

    entries.forEach((entry, index) => {
      if (entry.fullUrl && entry.resource) {
        const resource = entry.resource;

        // Skip UUID fullUrls
        if (entry.fullUrl.startsWith('urn:uuid:')) {
          return;
        }

        // Check if fullUrl ends with ResourceType/id
        const expectedSuffix = `${resource.resourceType}/${resource.id}`;

        if (resource.id && !entry.fullUrl.endsWith(expectedSuffix)) {
          issues.push({
            severity: 'warning',
            code: 'bundle-fullurl-mismatch',
            message: `Entry[${index}] fullUrl '${entry.fullUrl}' does not match resource ${expectedSuffix}`,
            entryIndex: index,
          });
        }
      }
    });

    return issues;
  }

  /**
   * Get all resources from Bundle entries
   */
  getAllBundleResources(bundle: any): any[] {
    const entries = this.extractBundleEntries(bundle);
    return entries
      .filter(entry => entry.resource)
      .map(entry => entry.resource);
  }

  /**
   * Find entry by fullUrl
   */
  findEntryByFullUrl(bundle: any, fullUrl: string): BundleEntry | null {
    const entries = this.extractBundleEntries(bundle);
    return entries.find(entry => entry.fullUrl === fullUrl) || null;
  }

  /**
   * Find entry by resource type and ID
   */
  findEntryByResourceTypeAndId(bundle: any, resourceType: string, resourceId: string): BundleEntry | null {
    const entries = this.extractBundleEntries(bundle);
    return entries.find(entry =>
      entry.resource?.resourceType === resourceType &&
      entry.resource?.id === resourceId
    ) || null;
  }

  /**
   * Build a fullUrl index for fast lookups
   */
  buildFullUrlIndex(bundle: any): Map<string, BundleEntry> {
    const entries = this.extractBundleEntries(bundle);
    const index = new Map<string, BundleEntry>();

    entries.forEach(entry => {
      if (entry.fullUrl) {
        index.set(entry.fullUrl, entry);
      }

      // Also index by ResourceType/id if available
      if (entry.resource?.resourceType && entry.resource?.id) {
        const relativeUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
        index.set(relativeUrl, entry);
      }
    });

    return index;
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

    // Validate fullUrl uniqueness and consistency
    const fullUrlIssues = this.validateFullUrlUniqueness(entries);
    issues.push(...fullUrlIssues);

    const consistencyIssues = this.validateFullUrlConsistency(entries);
    issues.push(...consistencyIssues);

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
    return bundle?.type === 'transaction' || bundle?.type === 'batch';
  }

  /**
   * Get Bundle type
   */
  getBundleType(bundle: any): string | null {
    return bundle?.type || null;
  }

  /**
   * Validate Bundle structure
   */
  validateBundleStructure(bundle: any): Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
  }> {
    const issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
    }> = [];

    // Check Bundle type
    if (!bundle.type) {
      issues.push({
        severity: 'error',
        code: 'bundle-missing-type',
        message: 'Bundle.type is required',
      });
    }

    // Check entries array
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

    // Validate transaction/batch Bundle requirements
    if (this.isTransactionOrBatchBundle(bundle)) {
      const entries = this.extractBundleEntries(bundle);

      entries.forEach((entry, index) => {
        if (!entry.request) {
          issues.push({
            severity: 'error',
            code: 'bundle-entry-missing-request',
            message: `Transaction/batch Bundle entry[${index}] missing required 'request' element`,
          });
        } else {
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
        }
      });
    }

    return issues;
  }

  /**
   * Extract resource statistics from Bundle
   */
  getBundleStatistics(bundle: any): {
    totalEntries: number;
    resourceTypes: Record<string, number>;
    hasFullUrls: number;
    hasUuidReferences: number;
    hasRelativeReferences: number;
    hasExternalReferences: number;
  } {
    const entries = this.extractBundleEntries(bundle);
    const allReferences = this.findAllBundleReferences(bundle);
    const resourceTypes: Record<string, number> = {};

    entries.forEach(entry => {
      if (entry.resource?.resourceType) {
        const type = entry.resource.resourceType;
        resourceTypes[type] = (resourceTypes[type] || 0) + 1;
      }
    });

    const hasFullUrls = entries.filter(e => e.fullUrl).length;
    const hasUuidReferences = allReferences.filter(r => r.reference.startsWith('urn:uuid:')).length;
    const relativeRefs = allReferences.filter(r => {
      const parsed = parseReference(r.reference);
      return parsed.referenceType === 'relative';
    }).length;
    const externalRefs = allReferences.filter(r => {
      const parsed = parseReference(r.reference);
      return parsed.referenceType === 'absolute' || parsed.referenceType === 'canonical';
    }).length;

    return {
      totalEntries: entries.length,
      resourceTypes,
      hasFullUrls,
      hasUuidReferences,
      hasRelativeReferences: relativeRefs,
      hasExternalReferences: externalRefs,
    };
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


