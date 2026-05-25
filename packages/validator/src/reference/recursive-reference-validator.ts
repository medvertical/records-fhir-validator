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
import {
  extractReferencesToValidate,
  filterReferences,
  getResourceIdentifier,
  isTimeoutReached,
  resolveBundleReference,
  resolveContainedReference,
  type ReferenceToValidate,
} from './recursive-reference-helpers';
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
    if (isTimeoutReached(context)) {
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
    const resourceId = getResourceIdentifier(resource);
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
    const references = extractReferencesToValidate(resource, resourceId, context.currentDepth);

    // Filter and limit references
    const filteredReferences = filterReferences(references, context);

    // Validate each reference
    for (const ref of filteredReferences) {
      const shouldContinue = await this.processReference(
        ref,
        resource,
        context,
        currentChain,
        result,
        resourceFetcher,
      );
      if (!shouldContinue) return;
    }
  }

  private async processReference(
    ref: ReferenceToValidate,
    resource: any,
    context: RecursiveValidationContext,
    currentChain: string[],
    result: RecursiveValidationResult,
    resourceFetcher?: (reference: string) => Promise<any>,
  ): Promise<boolean> {
    if (isTimeoutReached(context)) {
      result.timedOut = true;
      return false;
    }

    const refIdentifier = ref.resourceType && ref.resourceId
      ? `${ref.resourceType}/${ref.resourceId}`
      : ref.reference;

    if (this.circularDetector.wouldCreateCircularReference(currentChain, refIdentifier)) {
      logger.warn(`[RecursiveReferenceValidator] Circular reference detected: ${refIdentifier}`);
      result.circularReferences.push([...currentChain, refIdentifier]);
      return true;
    }

    if (ref.reference.startsWith('#')) {
      if (ref.reference === '#') return true;
      const referencedResource = resolveContainedReference(resource, ref.reference);
      await this.validateResolvedReference(ref, referencedResource, context, currentChain, result, resourceFetcher);
      return true;
    }

    const bundleReferencedResource = resolveBundleReference(resource, ref.reference);
    if (bundleReferencedResource) {
      await this.validateResolvedReference(ref, bundleReferencedResource, context, currentChain, result, resourceFetcher);
      return true;
    }

    await this.fetchAndValidateReference(ref, context, currentChain, result, resourceFetcher);
    return true;
  }

  private async validateResolvedReference(
    ref: ReferenceToValidate,
    referencedResource: any | null,
    context: RecursiveValidationContext,
    currentChain: string[],
    result: RecursiveValidationResult,
    resourceFetcher?: (reference: string) => Promise<any>,
  ): Promise<void> {
    if (!referencedResource) {
      result.unresolvedReferences.push(ref.reference);
      return;
    }

    result.referencesFollowed++;
    await this.validateResourceRecursively(
      referencedResource,
      this.createChildContext(context, currentChain),
      result,
      resourceFetcher,
    );
  }

  private async fetchAndValidateReference(
    ref: ReferenceToValidate,
    context: RecursiveValidationContext,
    currentChain: string[],
    result: RecursiveValidationResult,
    resourceFetcher?: (reference: string) => Promise<any>,
  ): Promise<void> {
    if (!resourceFetcher) {
      if (!context.config.validateExternal) {
        return;
      }
      result.unresolvedReferences.push(ref.reference);
      return;
    }

    try {
      const referencedResource = await resourceFetcher(ref.reference);
      await this.validateResolvedReference(ref, referencedResource, context, currentChain, result, resourceFetcher);
    } catch (error) {
      logger.error(`[RecursiveReferenceValidator] Failed to fetch ${ref.reference}:`, error);
      result.unresolvedReferences.push(ref.reference);
    }
  }

  private createChildContext(
    context: RecursiveValidationContext,
    currentChain: string[],
  ): RecursiveValidationContext {
    return {
      ...context,
      currentDepth: context.currentDepth + 1,
      referenceChain: currentChain,
    };
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
    const references = extractReferencesToValidate(resource, 'root', 0);
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
