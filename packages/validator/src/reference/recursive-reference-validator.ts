/**
 * Recursive Reference Validator
 * 
 * Validates referenced resources recursively with configurable depth limits.
 * Prevents infinite loops using circular reference detection.
 * 
 * Task 6.6: Implement optional recursive validation (validate referenced resources)
 * Task 6.7: Add validation depth limit configuration (default: 1 level, max: 3 levels)
 */

import { getCircularReferenceDetector } from './circular-reference-detector';
import { parseReference } from './reference-type-extractor';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface RecursiveValidationConfig {
  /** Whether to enable recursive validation (default: false) */
  enabled: boolean;
  /** Maximum depth to validate (default: 1, max: 3) */
  maxDepth: number;
  /** Whether to validate external references (default: false) */
  validateExternal: boolean;
  /** Whether to validate contained references recursively (default: true) */
  validateContained: boolean;
  /** Whether to validate Bundle entries recursively (default: true) */
  validateBundleEntries: boolean;
  /** Resource types to exclude from recursive validation */
  excludeResourceTypes?: string[];
  /** Maximum references to follow per resource (default: 10) */
  maxReferencesPerResource?: number;
  /** Timeout in milliseconds for recursive validation (default: 30000) */
  timeoutMs?: number;
}

export interface RecursiveValidationContext {
  /** Current depth in the validation chain */
  currentDepth: number;
  /** Reference chain leading to this validation */
  referenceChain: string[];
  /** Resource IDs already validated (to prevent duplicates) */
  validatedResources: Set<string>;
  /** Start time for timeout tracking */
  startTime: number;
  /** Configuration */
  config: RecursiveValidationConfig;
}

export interface RecursiveValidationResult {
  /** Total resources validated */
  totalResourcesValidated: number;
  /** Maximum depth reached */
  maxDepthReached: number;
  /** Number of references followed */
  referencesFollowed: number;
  /** Resources that couldn't be resolved */
  unresolvedReferences: string[];
  /** Circular references detected */
  circularReferences: string[][];
  /** Validation time in milliseconds */
  validationTimeMs: number;
  /** Whether timeout was reached */
  timedOut: boolean;
}

export interface ReferenceToValidate {
  /** The reference string */
  reference: string;
  /** Resource type if known */
  resourceType?: string;
  /** Resource ID if known */
  resourceId?: string;
  /** Field path where reference was found */
  fieldPath: string;
  /** Parent resource ID */
  parentResourceId: string;
  /** Depth in validation chain */
  depth: number;
}

// ============================================================================
// Recursive Reference Validator Class
// ============================================================================

export class RecursiveReferenceValidator {
  private circularDetector = getCircularReferenceDetector();
  private defaultConfig: RecursiveValidationConfig = {
    enabled: false,
    maxDepth: 1,
    validateExternal: false,
    validateContained: true,
    validateBundleEntries: true,
    excludeResourceTypes: [],
    maxReferencesPerResource: 10,
    timeoutMs: 30000,
  };

  /**
   * Validate references recursively
   */
  async validateRecursively(
    resource: any,
    config: Partial<RecursiveValidationConfig> = {},
    resourceFetcher?: (reference: string) => Promise<any>
  ): Promise<RecursiveValidationResult> {
    const fullConfig: RecursiveValidationConfig = {
      ...this.defaultConfig,
      ...config,
    };

    // Enforce max depth limits
    if (fullConfig.maxDepth > 3) {
      logger.warn('[RecursiveReferenceValidator] Max depth capped at 3 for safety');
      fullConfig.maxDepth = 3;
    }

    const context: RecursiveValidationContext = {
      currentDepth: 0,
      referenceChain: [],
      validatedResources: new Set<string>(),
      startTime: Date.now(),
      config: fullConfig,
    };

    const result: RecursiveValidationResult = {
      totalResourcesValidated: 0,
      maxDepthReached: 0,
      referencesFollowed: 0,
      unresolvedReferences: [],
      circularReferences: [],
      validationTimeMs: 0,
      timedOut: false,
    };

    // Check if recursive validation is enabled
    if (!fullConfig.enabled) {
      logger.info('[RecursiveReferenceValidator] Recursive validation disabled');
      return result;
    }

    // Perform recursive validation
    await this.validateResourceRecursively(
      resource,
      context,
      result,
      resourceFetcher
    );

    result.validationTimeMs = Date.now() - context.startTime;

    logger.info(
      `[RecursiveReferenceValidator] Completed: ` +
      `${result.totalResourcesValidated} resources, ` +
      `${result.referencesFollowed} references, ` +
      `max depth: ${result.maxDepthReached}, ` +
      `time: ${result.validationTimeMs}ms`
    );

    return result;
  }

  /**
   * Validate a single resource and its references recursively
   */
  private async validateResourceRecursively(
    resource: any,
    context: RecursiveValidationContext,
    result: RecursiveValidationResult,
    resourceFetcher?: (reference: string) => Promise<any>
  ): Promise<void> {
    // Handle null/undefined resource
    if (!resource || typeof resource !== 'object') {
      return;
    }

    // Check timeout
    if (this.isTimeoutReached(context)) {
      logger.warn('[RecursiveReferenceValidator] Timeout reached');
      result.timedOut = true;
      return;
    }

    // Check depth limit
    if (context.currentDepth >= context.config.maxDepth) {
      logger.info(`[RecursiveReferenceValidator] Max depth ${context.config.maxDepth} reached`);
      return;
    }

    // Track resource
    const resourceId = this.getResourceIdentifier(resource);
    if (context.validatedResources.has(resourceId)) {
      return; // Already validated
    }

    context.validatedResources.add(resourceId);
    result.totalResourcesValidated++;
    result.maxDepthReached = Math.max(result.maxDepthReached, context.currentDepth);

    logger.info(
      `[RecursiveReferenceValidator] [Depth ${context.currentDepth}] Validating ${resource.resourceType}/${resource.id || 'unknown'}`
    );

    // Add current resource to chain for circular detection
    const currentChain = [...context.referenceChain, resourceId];

    // Extract references from this resource
    const references = this.extractReferencesToValidate(resource, resourceId, context.currentDepth);

    // Filter and limit references
    const filteredReferences = this.filterReferences(references, context);

    // Validate each reference
    for (const ref of filteredReferences) {
      // Check timeout again before processing each reference
      if (this.isTimeoutReached(context)) {
        result.timedOut = true;
        return;
      }

      // Check if this would create a circular reference
      // Use the actual resource identifier for the check
      const refIdentifier = ref.resourceType && ref.resourceId
        ? `${ref.resourceType}/${ref.resourceId}`
        : ref.reference;

      const wouldBeCircular = this.circularDetector.wouldCreateCircularReference(
        currentChain,
        refIdentifier
      );

      if (wouldBeCircular) {
        logger.warn(`[RecursiveReferenceValidator] Circular reference detected: ${refIdentifier}`);
        result.circularReferences.push([...currentChain, refIdentifier]);
        continue;
      }

      // Try to resolve and validate the referenced resource
      if (resourceFetcher) {
        try {
          const referencedResource = await resourceFetcher(ref.reference);

          if (referencedResource) {
            result.referencesFollowed++;

            // Create new context for recursive call
            const childContext: RecursiveValidationContext = {
              ...context,
              currentDepth: context.currentDepth + 1,
              referenceChain: currentChain, // Use current chain which includes this resource
            };

            // Recursively validate
            await this.validateResourceRecursively(
              referencedResource,
              childContext,
              result,
              resourceFetcher
            );
          } else {
            result.unresolvedReferences.push(ref.reference);
          }
        } catch (error) {
          logger.error(`[RecursiveReferenceValidator] Failed to fetch ${ref.reference}:`, error);
          result.unresolvedReferences.push(ref.reference);
        }
      } else {
        // No fetcher provided, just track as unresolved
        result.unresolvedReferences.push(ref.reference);
      }
    }
  }

  /**
   * Extract references that should be validated from a resource
   */
  private extractReferencesToValidate(
    resource: any,
    parentResourceId: string,
    depth: number
  ): ReferenceToValidate[] {
    const references: ReferenceToValidate[] = [];

    if (!resource || typeof resource !== 'object') {
      return references;
    }

    this.extractReferencesFromObject(resource, '', parentResourceId, depth, references);

    return references;
  }

  /**
   * Recursively extract references from an object
   */
  private extractReferencesFromObject(
    obj: any,
    path: string,
    parentResourceId: string,
    depth: number,
    references: ReferenceToValidate[]
  ): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    // Check if this is a reference object
    if (obj.reference && typeof obj.reference === 'string') {
      const parseResult = parseReference(obj.reference);

      references.push({
        reference: obj.reference,
        resourceType: parseResult.resourceType || undefined,
        resourceId: parseResult.resourceId || undefined,
        fieldPath: path || 'reference',
        parentResourceId,
        depth,
      });
    }

    // Recursively check properties
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          this.extractReferencesFromObject(
            item,
            `${newPath}[${index}]`,
            parentResourceId,
            depth,
            references
          );
        });
      } else if (value && typeof value === 'object') {
        this.extractReferencesFromObject(value, newPath, parentResourceId, depth, references);
      }
    }
  }

  /**
   * Filter references based on configuration
   */
  private filterReferences(
    references: ReferenceToValidate[],
    context: RecursiveValidationContext
  ): ReferenceToValidate[] {
    let filtered = references;

    // Filter by excluded resource types
    if (context.config.excludeResourceTypes && context.config.excludeResourceTypes.length > 0) {
      filtered = filtered.filter(
        ref => !ref.resourceType || !context.config.excludeResourceTypes!.includes(ref.resourceType)
      );
    }

    // Filter external references if not enabled
    if (!context.config.validateExternal) {
      filtered = filtered.filter(ref => {
        const parseResult = parseReference(ref.reference);
        return parseResult.referenceType !== 'absolute' && parseResult.referenceType !== 'canonical';
      });
    }

    // Limit number of references per resource
    const maxRefs = context.config.maxReferencesPerResource || 10;
    if (filtered.length > maxRefs) {
      logger.warn(
        `[RecursiveReferenceValidator] Limiting references from ${filtered.length} to ${maxRefs}`
      );
      filtered = filtered.slice(0, maxRefs);
    }

    return filtered;
  }

  /**
   * Get resource identifier for tracking
   */
  private getResourceIdentifier(resource: any): string {
    if (!resource || typeof resource !== 'object') {
      return `unknown-${Date.now()}-${Math.random()}`;
    }
    if (resource.resourceType && resource.id) {
      return `${resource.resourceType}/${resource.id}`;
    }
    if (resource.id) {
      return resource.id;
    }
    // Fallback: use resource hash or random ID
    return `unknown-${Date.now()}-${Math.random()}`;
  }

  /**
   * Check if timeout has been reached
   */
  private isTimeoutReached(context: RecursiveValidationContext): boolean {
    const elapsed = Date.now() - context.startTime;
    const timeout = context.config.timeoutMs || 30000;
    return elapsed >= timeout;
  }

  /**
   * Estimate validation cost (for planning)
   */
  estimateValidationCost(
    resource: any,
    config: Partial<RecursiveValidationConfig> = {}
  ): {
    estimatedResources: number;
    estimatedReferences: number;
    estimatedTimeMs: number;
    wouldExceedLimits: boolean;
  } {
    const fullConfig: RecursiveValidationConfig = {
      ...this.defaultConfig,
      ...config,
    };

    // Simple estimation based on reference count
    const references = this.extractReferencesToValidate(resource, 'root', 0);
    const estimatedResources = Math.min(
      references.length * fullConfig.maxDepth,
      100 // Cap estimate
    );

    return {
      estimatedResources,
      estimatedReferences: references.length,
      estimatedTimeMs: estimatedResources * 100, // Rough estimate: 100ms per resource
      wouldExceedLimits: estimatedResources > 50 || references.length > 20,
    };
  }

  /**
   * Get default configuration
   */
  getDefaultConfig(): RecursiveValidationConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Create a safe configuration with validation
   */
  createSafeConfig(config: Partial<RecursiveValidationConfig>): RecursiveValidationConfig {
    const safeConfig: RecursiveValidationConfig = {
      ...this.defaultConfig,
      ...config,
    };

    // Enforce safety limits
    safeConfig.maxDepth = Math.min(Math.max(safeConfig.maxDepth, 0), 3);
    safeConfig.maxReferencesPerResource = Math.min(safeConfig.maxReferencesPerResource || 10, 20);
    safeConfig.timeoutMs = Math.min(safeConfig.timeoutMs || 30000, 60000);

    return safeConfig;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let validatorInstance: RecursiveReferenceValidator | null = null;

export function getRecursiveReferenceValidator(): RecursiveReferenceValidator {
  if (!validatorInstance) {
    validatorInstance = new RecursiveReferenceValidator();
  }
  return validatorInstance;
}

export function resetRecursiveReferenceValidator(): void {
  validatorInstance = null;
}

