/**
 * Reference Type Extractor
 * 
 * Utility for extracting resource types from FHIR reference strings.
 * Handles various reference formats including relative, absolute, canonical, and contained references.
 * 
 * Task 6.1: Add resource type extraction from reference strings
 */

import {
  CANONICAL_PATTERNS,
  KNOWN_FHIR_RESOURCE_TYPES,
  getKnownFhirResourceTypes,
  isFhirVersionPathSegment,
} from './reference-resource-types.js';
import type {
  ReferenceParseResult,
  ReferenceTypeExtractionOptions,
} from './reference-type-extractor-types.js';
import { parseAbsoluteReference, parseCanonicalReference } from './reference-url-parser.js';

export type {
  ReferenceParseResult,
  ReferenceTypeExtractionOptions,
} from './reference-type-extractor-types.js';

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Reference Type Extractor Class
// ============================================================================

export class ReferenceTypeExtractor {
  private options: Required<ReferenceTypeExtractionOptions>;

  constructor(options: ReferenceTypeExtractionOptions = {}) {
    this.options = {
      allowContained: options.allowContained ?? true,
      allowCanonical: options.allowCanonical ?? true,
      extractVersion: options.extractVersion ?? true,
      validateResourceType: options.validateResourceType ?? false,
    };
  }

  /**
   * Extract resource type from a reference string
   */
  extractResourceType(reference: string): string | null {
    const result = this.parseReference(reference);
    return result.resourceType;
  }

  /**
   * Parse a reference string and extract all components
   */
  parseReference(reference: string): ReferenceParseResult {
    if (!reference || typeof reference !== 'string') {
      return this.createInvalidResult(reference, 'Reference is not a valid string');
    }

    const trimmedRef = reference.trim();
    
    // Handle contained references (#resource-id)
    if (trimmedRef.startsWith('#')) {
      return this.parseContainedReference(trimmedRef);
    }

    // Handle canonical URLs (check BEFORE absolute URLs since canonical are also URLs)
    if (this.isCanonicalUrl(trimmedRef)) {
      return this.parseCanonicalReference(trimmedRef);
    }

    // Handle absolute URLs
    if (this.isAbsoluteUrl(trimmedRef)) {
      return this.parseAbsoluteReference(trimmedRef);
    }

    // Handle conditional references (ResourceType?search-params). These are
    // relative URLs used primarily in transaction bundles and still carry a
    // target resource type for type-constraint checks.
    if (this.isConditionalReference(trimmedRef)) {
      return this.parseConditionalReference(trimmedRef);
    }

    // Handle relative references (ResourceType/id)
    return this.parseRelativeReference(trimmedRef);
  }

  /**
   * Parse contained reference (#resource-id)
   */
  private parseContainedReference(reference: string): ReferenceParseResult {
    if (!this.options.allowContained) {
      return this.createInvalidResult(reference, 'Contained references not allowed');
    }

    const resourceId = reference.slice(1); // Remove #
    
    if (!resourceId) {
      return this.createInvalidResult(reference, 'Contained reference missing resource ID');
    }

    return {
      resourceType: null, // Contained resources don't have a type in the reference
      resourceId,
      referenceType: 'contained',
      isValid: true,
      originalReference: reference,
    };
  }

  /**
   * Parse absolute URL reference
   */
  private parseAbsoluteReference(reference: string): ReferenceParseResult {
    return parseAbsoluteReference(reference, this.options.validateResourceType);
  }

  private parseConditionalReference(reference: string): ReferenceParseResult {
    const [resourceType] = reference.split('?', 1);
    const isValidResourceType = this.isValidResourceType(resourceType);

    return {
      resourceType: isValidResourceType ? resourceType : null,
      resourceId: null,
      referenceType: isValidResourceType ? 'relative' : 'invalid',
      isValid: isValidResourceType,
      originalReference: reference,
      metadata: {
        isBundle: true,
      },
    };
  }

  /**
   * Parse canonical URL reference
   */
  private parseCanonicalReference(reference: string): ReferenceParseResult {
    return parseCanonicalReference(reference, {
      allowCanonical: this.options.allowCanonical,
      validateKnownResourceType: this.options.validateResourceType,
    });
  }

  /**
   * Parse relative reference (ResourceType/id)
   */
  private parseRelativeReference(reference: string): ReferenceParseResult {
    // Handle version suffix (ResourceType/id/_history/version)
    const historyMatch = reference.match(/^([^/]+)\/([^/]+)\/_history\/(.+)$/);
    if (historyMatch) {
      const [, resourceType, resourceId, version] = historyMatch;
      const isValidResourceType = this.isValidResourceType(resourceType);
      
      return {
        resourceType: isValidResourceType ? resourceType : null,
        resourceId,
        referenceType: isValidResourceType ? 'relative' : 'invalid',
        isValid: isValidResourceType && !!resourceId,
        originalReference: reference,
        version,
        metadata: {
          isHistorical: true,
          hasVersion: true,
        },
      };
    }

    // Standard format: ResourceType/id
    const parts = reference.split('/');
    
    if (parts.length !== 2) {
      return this.createInvalidResult(reference, 'Relative reference must be in format ResourceType/id');
    }

    const [resourceType, resourceId] = parts;
    
    // Check if resource type starts with uppercase (FHIR requirement)
    if (!/^[A-Z]/.test(resourceType)) {
      return this.createInvalidResult(reference, 'Resource type must start with uppercase letter');
    }
    
    // Check if resource ID is empty
    if (!resourceId || resourceId.trim() === '') {
      return this.createInvalidResult(reference, 'Resource ID is required');
    }
    
    const isValidResourceType = this.isValidResourceType(resourceType);
    
    return {
      resourceType: isValidResourceType ? resourceType : null,
      resourceId,
      referenceType: isValidResourceType ? 'relative' : 'invalid',
      isValid: isValidResourceType,
      originalReference: reference,
    };
  }

  /**
   * Check if a string is an absolute URL
   */
  private isAbsoluteUrl(reference: string): boolean {
    return /^https?:\/\//.test(reference) && !this.isCanonicalUrl(reference);
  }

  /**
   * Check if a string is a canonical URL
   * Canonical URLs reference conformance resources, not instance data
   */
  private isCanonicalUrl(reference: string): boolean {
    // Strip version if present (url|version)
    const baseRef = reference.split('|')[0];
    
    // Canonical URLs must match specific patterns
    const matchesPattern = CANONICAL_PATTERNS.some(pattern => pattern.test(baseRef));
    
    return matchesPattern;
  }

  private isConditionalReference(reference: string): boolean {
    return /^[A-Z][a-zA-Z]+\?.+$/.test(reference);
  }

  /**
   * Validate if a string is a known FHIR resource type
   */
  private isValidResourceType(resourceType: string): boolean {
    if (isFhirVersionPathSegment(resourceType)) {
      return false;
    }

    if (!this.options.validateResourceType) {
      // If validation is disabled, assume valid if it looks like a resource type
      return /^[A-Z][a-zA-Z0-9]*$/.test(resourceType);
    }
    
    return KNOWN_FHIR_RESOURCE_TYPES.has(resourceType);
  }

  /**
   * Create an invalid result object
   */
  private createInvalidResult(reference: string, reason: string): ReferenceParseResult {
    return {
      resourceType: null,
      resourceId: null,
      referenceType: 'invalid',
      isValid: false,
      originalReference: reference,
      metadata: { error: reason },
    };
  }

  /**
   * Batch extract resource types from multiple references
   */
  extractMultiple(references: string[]): ReferenceParseResult[] {
    return references.map(ref => this.parseReference(ref));
  }

  /**
   * Get only valid references from a list
   */
  getValidReferences(references: string[]): ReferenceParseResult[] {
    return this.extractMultiple(references).filter(result => result.isValid);
  }

  /**
   * Get unique resource types from a list of references
   */
  getUniqueResourceTypes(references: string[]): string[] {
    const resourceTypes = new Set<string>();
    
    for (const reference of references) {
      const result = this.parseReference(reference);
      if (result.isValid && result.resourceType) {
        resourceTypes.add(result.resourceType);
      }
    }
    
    return Array.from(resourceTypes);
  }

  /**
   * Check if a reference is of a specific resource type
   */
  isReferenceOfType(reference: string, resourceType: string): boolean {
    const result = this.parseReference(reference);
    return result.isValid && result.resourceType === resourceType;
  }

  /**
   * Filter references by resource type
   */
  filterByResourceType(references: string[], resourceType: string): string[] {
    return references.filter(ref => this.isReferenceOfType(ref, resourceType));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Static utility function for quick resource type extraction
 */
export function extractResourceType(reference: string): string | null {
  const extractor = new ReferenceTypeExtractor();
  return extractor.extractResourceType(reference);
}

/**
 * Static utility function for parsing references
 */
export function parseReference(reference: string, options?: ReferenceTypeExtractionOptions): ReferenceParseResult {
  const extractor = new ReferenceTypeExtractor(options);
  return extractor.parseReference(reference);
}

/**
 * Check if a reference is valid
 */
export function isValidReference(reference: string): boolean {
  const result = parseReference(reference);
  return result.isValid;
}

/**
 * Get all known FHIR resource types
 */
export function getKnownResourceTypes(): string[] {
  return getKnownFhirResourceTypes();
}

// ============================================================================
// Export singleton instance
// ============================================================================

const defaultExtractor = new ReferenceTypeExtractor();
export { defaultExtractor as referenceTypeExtractor };
