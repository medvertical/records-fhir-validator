/**
 * Contained Reference Resolver
 * 
 * Handles resolution and validation of contained resource references in FHIR resources.
 * Validates that contained references (#resource-id) exist and match type constraints.
 * 
 * Task 6.3: Add support for contained resource reference validation
 */

import { extractResourceType as _extractResourceType, parseReference } from './reference-type-extractor';

// ============================================================================
// Types
// ============================================================================

export interface ContainedResource {
  /** Resource ID (without the # prefix) */
  id: string;
  /** Resource type */
  resourceType: string;
  /** The full contained resource */
  resource: any;
}

export interface ContainedReferenceResolutionResult {
  /** Whether the contained reference was found */
  found: boolean;
  /** The resolved contained resource if found */
  resource?: ContainedResource;
  /** Error message if not found */
  errorMessage?: string;
  /** The reference ID that was searched */
  referenceId: string;
  /** Whether the reference type matches (if type constraint specified) */
  typeMatches?: boolean;
  /** Expected type if constraint specified */
  expectedType?: string;
}

export interface ContainedReferenceValidationResult {
  /** Whether the contained reference is valid */
  isValid: boolean;
  /** Validation message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Error code if invalid */
  code?: string;
  /** Resolution result */
  resolution?: ContainedReferenceResolutionResult;
}

// ============================================================================
// Contained Reference Resolver Class
// ============================================================================

export class ContainedReferenceResolver {
  /**
   * Extract all contained resources from a FHIR resource
   */
  extractContainedResources(resource: any): ContainedResource[] {
    if (!resource || !resource.contained || !Array.isArray(resource.contained)) {
      return [];
    }

    return resource.contained
      .filter((contained: any) => contained && contained.id && contained.resourceType)
      .map((contained: any) => ({
        id: contained.id,
        resourceType: contained.resourceType,
        resource: contained,
      }));
  }

  /**
   * Resolve a contained reference within a resource
   */
  resolveContainedReference(
    reference: string,
    parentResource: any,
    expectedType?: string
  ): ContainedReferenceResolutionResult {
    // Check if it starts with # (contained reference format)
    if (!reference || !reference.startsWith('#')) {
      return {
        found: false,
        referenceId: reference,
        errorMessage: 'Reference is not a contained reference (must start with #)',
      };
    }

    // Parse the reference to extract the ID
    const parseResult = parseReference(reference);
    const referenceId = parseResult.resourceId;

    if (!referenceId || referenceId.trim() === '') {
      return {
        found: false,
        referenceId: reference,
        errorMessage: 'Contained reference missing resource ID',
      };
    }

    // Extract contained resources from parent
    const containedResources = this.extractContainedResources(parentResource);

    if (containedResources.length === 0) {
      return {
        found: false,
        referenceId,
        errorMessage: 'Parent resource has no contained resources',
      };
    }

    // Find the referenced contained resource
    const matchedResource = containedResources.find(cr => cr.id === referenceId);

    if (!matchedResource) {
      return {
        found: false,
        referenceId,
        errorMessage: `Contained resource with id '${referenceId}' not found in parent resource`,
      };
    }

    // Check type if expected type is specified
    let typeMatches = true;
    if (expectedType) {
      typeMatches = matchedResource.resourceType === expectedType;
    }

    return {
      found: true,
      resource: matchedResource,
      referenceId,
      typeMatches,
      expectedType,
    };
  }

  /**
   * Validate a contained reference
   */
  validateContainedReference(
    reference: string,
    parentResource: any,
    expectedTypes?: string[]
  ): ContainedReferenceValidationResult {
    // First resolve the reference
    const resolution = this.resolveContainedReference(reference, parentResource);

    if (!resolution.found) {
      return {
        isValid: false,
        message: resolution.errorMessage || 'Contained reference not found',
        severity: 'error',
        code: 'contained-reference-not-found',
        resolution,
      };
    }

    // If expected types are specified, validate the type
    if (expectedTypes && expectedTypes.length > 0 && resolution.resource) {
      const actualType = resolution.resource.resourceType;
      const typeAllowed = expectedTypes.includes(actualType) || expectedTypes.includes('Resource');

      if (!typeAllowed) {
        return {
          isValid: false,
          message: `Contained resource has type '${actualType}' but expected one of: ${expectedTypes.join(', ')}`,
          severity: 'error',
          code: 'contained-reference-type-mismatch',
          resolution: {
            ...resolution,
            typeMatches: false,
            expectedType: expectedTypes.join(', '),
          },
        };
      }
    }

    return {
      isValid: true,
      message: `Contained reference '${reference}' successfully resolved to ${resolution.resource?.resourceType}/${resolution.resource?.id}`,
      severity: 'info',
      resolution,
    };
  }

  /**
   * Validate all contained references in a resource
   */
  validateAllContainedReferences(
    resource: any,
    references: Array<{ reference: string; fieldPath: string; expectedTypes?: string[] }>
  ): Array<ContainedReferenceValidationResult & { fieldPath: string }> {
    return references.map(({ reference, fieldPath, expectedTypes }) => ({
      ...this.validateContainedReference(reference, resource, expectedTypes),
      fieldPath,
    }));
  }

  /**
   * Find all contained references in a resource
   */
  findContainedReferences(resource: any, fieldPath: string = ''): string[] {
    const references: string[] = [];

    if (!resource || typeof resource !== 'object') {
      return references;
    }

    // Check if this is a reference object
    if (resource.reference && typeof resource.reference === 'string') {
      const parseResult = parseReference(resource.reference);
      if (parseResult.referenceType === 'contained') {
        references.push(resource.reference);
      }
    }

    // Recursively check all properties
    for (const [key, value] of Object.entries(resource)) {
      if (key === 'contained') {
        // Skip the contained array itself to avoid circular processing
        continue;
      }

      const newPath = fieldPath ? `${fieldPath}.${key}` : key;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const arrayPath = `${newPath}[${index}]`;
          references.push(...this.findContainedReferences(item, arrayPath));
        });
      } else if (value && typeof value === 'object') {
        references.push(...this.findContainedReferences(value, newPath));
      }
    }

    return references;
  }

  /**
   * Get contained resource by ID
   */
  getContainedResourceById(parentResource: any, resourceId: string): ContainedResource | null {
    const contained = this.extractContainedResources(parentResource);
    return contained.find(cr => cr.id === resourceId) || null;
  }

  /**
   * Check if a resource has contained resources
   */
  hasContainedResources(resource: any): boolean {
    return !!resource?.contained && Array.isArray(resource.contained) && resource.contained.length > 0;
  }

  /**
   * Get all contained resource IDs
   */
  getContainedResourceIds(parentResource: any): string[] {
    const contained = this.extractContainedResources(parentResource);
    return contained.map(cr => cr.id);
  }

  /**
   * Get all contained resources of a specific type
   */
  getContainedResourcesByType(parentResource: any, resourceType: string): ContainedResource[] {
    const contained = this.extractContainedResources(parentResource);
    return contained.filter(cr => cr.resourceType === resourceType);
  }

  /**
   * Validate that all contained resources are referenced
   */
  validateUnreferencedContainedResources(resource: any): {
    unreferencedResources: ContainedResource[];
    warnings: string[];
  } {
    const containedResources = this.extractContainedResources(resource);
    const referencedIds = new Set(
      this.findContainedReferences(resource)
        .map(ref => ref.replace('#', ''))
    );

    const unreferencedResources = containedResources.filter(
      cr => !referencedIds.has(cr.id)
    );

    const warnings = unreferencedResources.map(
      cr => `Contained resource ${cr.resourceType}/${cr.id} is not referenced`
    );

    return {
      unreferencedResources,
      warnings,
    };
  }

  /**
   * Check for orphaned contained references (references that don't exist)
   */
  findOrphanedReferences(resource: any): Array<{
    reference: string;
    fieldPath?: string;
  }> {
    const allReferences = this.findContainedReferences(resource);
    const containedIds = new Set(this.getContainedResourceIds(resource));

    return allReferences
      .map(ref => {
        const parseResult = parseReference(ref);
        return {
          reference: ref,
          resourceId: parseResult.resourceId,
        };
      })
      .filter(({ resourceId }) => resourceId && !containedIds.has(resourceId))
      .map(({ reference }) => ({ reference }));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let resolverInstance: ContainedReferenceResolver | null = null;

export function getContainedReferenceResolver(): ContainedReferenceResolver {
  if (!resolverInstance) {
    resolverInstance = new ContainedReferenceResolver();
  }
  return resolverInstance;
}

export function resetContainedReferenceResolver(): void {
  resolverInstance = null;
}

