/**
 * Validates referenced resources recursively with configurable depth limits.
 * Prevents infinite loops using circular reference detection.
 */

import { CircularReferenceDetector } from './circular-reference-detector.js';
import {
  extractReferencesToValidate,
  filterReferences,
  getResourceIdentifier,
  ResourceIdentityRegistry,
  isTimeoutReached,
  resolveBundleReference,
  resolveContainedReference,
  type ReferenceToValidate,
} from './recursive-reference-helpers.js';
import { logger } from '../logger.js';
import { classifyReferenceRequestFailure } from './reference-request-failure.js';
import {
  createSafeRecursiveValidationConfig,
  estimateRecursiveValidationCost,
  getDefaultRecursiveValidationConfig,
  type RecursiveValidationConfig,
} from './recursive-reference-config.js';
import { fetchReferenceWithinDeadline, ReferenceFetchTimeoutError, type ReferenceResourceFetcher } from './reference-fetch-deadline.js';

export type { RecursiveValidationConfig } from './recursive-reference-config.js';

export interface RecursiveValidationContext {
  currentDepth: number;
  referenceChain: string[];
  validatedResources: Set<string>;
  startTime: number;
  config: RecursiveValidationConfig;
  resourceIdentities: ResourceIdentityRegistry;
}

export interface RecursiveValidationResult {
  totalResourcesValidated: number;
  maxDepthReached: number;
  referencesFollowed: number;
  unresolvedReferences: string[];
  circularReferences: string[][];
  validationTimeMs: number;
  timedOut: boolean;
}

export class RecursiveReferenceValidator {
  private readonly circularDetector = new CircularReferenceDetector();
  async validateRecursively(
    resource: unknown,
    config: Partial<RecursiveValidationConfig> = {},
    resourceFetcher?: ReferenceResourceFetcher
  ): Promise<RecursiveValidationResult> {
    const fullConfig = this.createSafeConfig(config);

    const context: RecursiveValidationContext = {
      currentDepth: 0,
      referenceChain: [],
      validatedResources: new Set<string>(),
      startTime: Date.now(),
      config: fullConfig,
      resourceIdentities: new ResourceIdentityRegistry(),
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

    if (!fullConfig.enabled) {
      logger.debug('[RecursiveReferenceValidator] Recursive validation disabled');
      return result;
    }

    await this.validateResourceRecursively(
      resource,
      context,
      result,
      resourceFetcher
    );

    result.validationTimeMs = Date.now() - context.startTime;

    const logCompletion = result.validationTimeMs > 100 ? logger.info.bind(logger) : logger.debug.bind(logger);
    logCompletion(
      `[RecursiveReferenceValidator] Completed: ` +
      `${result.totalResourcesValidated} resources, ` +
      `${result.referencesFollowed} references, ` +
      `max depth: ${result.maxDepthReached}, ` +
      `time: ${result.validationTimeMs}ms`
    );

    return result;
  }

  private async validateResourceRecursively(
    resource: unknown,
    context: RecursiveValidationContext,
    result: RecursiveValidationResult,
    resourceFetcher?: ReferenceResourceFetcher
  ): Promise<void> {
    const resourceRecord = toRecord(resource);
    if (!resourceRecord) return;

    if (isTimeoutReached(context)) {
      logger.warn('[RecursiveReferenceValidator] Timeout reached');
      result.timedOut = true;
      return;
    }

    if (context.currentDepth >= context.config.maxDepth) {
      logger.debug(`[RecursiveReferenceValidator] Max depth ${context.config.maxDepth} reached`);
      return;
    }

    const resourceId = getResourceIdentifier(resourceRecord, context.resourceIdentities);
    if (context.validatedResources.has(resourceId)) {
      return;
    }

    context.validatedResources.add(resourceId);
    result.totalResourcesValidated++;
    result.maxDepthReached = Math.max(result.maxDepthReached, context.currentDepth);

    logger.debug(
      `[RecursiveReferenceValidator] [Depth ${context.currentDepth}] Validating ` +
      `${getString(resourceRecord, 'resourceType') ?? 'Unknown'}/${getString(resourceRecord, 'id') ?? 'unknown'}`
    );

    const currentChain = [...context.referenceChain, resourceId];

    const references = extractReferencesToValidate(resourceRecord, resourceId, context.currentDepth);
    const filteredReferences = filterReferences(references, context);

    for (const ref of filteredReferences) {
      const shouldContinue = await this.processReference(
        ref,
        resourceRecord,
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
    resource: Record<string, unknown>,
    context: RecursiveValidationContext,
    currentChain: string[],
    result: RecursiveValidationResult,
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<boolean> {
    if (isTimeoutReached(context)) {
      result.timedOut = true;
      return false;
    }

    const refIdentifier = ref.resourceType && ref.resourceId
      ? `${ref.resourceType}/${ref.resourceId}`
      : ref.reference;

    if (this.circularDetector.wouldCreateCircularReference(currentChain, refIdentifier)) {
      if (isEnclosingBundleProvenanceTarget(resource, ref, refIdentifier, currentChain)) {
        return true;
      }

      logger.warn('[RecursiveReferenceValidator] Circular reference detected', {
        chainLength: currentChain.length + 1,
      });
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
    referencedResource: unknown,
    context: RecursiveValidationContext,
    currentChain: string[],
    result: RecursiveValidationResult,
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<void> {
    const resourceRecord = toRecord(referencedResource);
    if (!resourceRecord) {
      result.unresolvedReferences.push(ref.reference);
      return;
    }

    result.referencesFollowed++;
    await this.validateResourceRecursively(
      resourceRecord,
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
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<void> {
    if (!resourceFetcher) {
      result.unresolvedReferences.push(ref.reference);
      return;
    }

    try {
      const referencedResource = await fetchReferenceWithinDeadline(
        resourceFetcher,
        ref.reference,
        context.startTime,
        context.config.timeoutMs ?? 30_000,
      );
      await this.validateResolvedReference(ref, referencedResource, context, currentChain, result, resourceFetcher);
    } catch (error) {
      if (error instanceof ReferenceFetchTimeoutError) result.timedOut = true;
      const failure = classifyReferenceRequestFailure(error);
      logger.error('[RecursiveReferenceValidator] Reference fetch failed', failure.metadata);
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

  estimateValidationCost(
    resource: unknown,
    config: Partial<RecursiveValidationConfig> = {}
  ): {
    estimatedResources: number;
    estimatedReferences: number;
    estimatedTimeMs: number;
    wouldExceedLimits: boolean;
  } {
    return estimateRecursiveValidationCost(resource, config);
  }

  getDefaultConfig(): RecursiveValidationConfig {
    return getDefaultRecursiveValidationConfig();
  }

  createSafeConfig(config: Partial<RecursiveValidationConfig>): RecursiveValidationConfig {
    return createSafeRecursiveValidationConfig(config);
  }
}

function isEnclosingBundleProvenanceTarget(
  resource: unknown,
  ref: ReferenceToValidate,
  refIdentifier: string,
  currentChain: string[],
): boolean {
  const bundle = toRecord(resource);
  if (bundle?.resourceType !== 'Bundle') return false;
  if (refIdentifier !== currentChain[currentChain.length - 1]) return false;

  const match = /^entry\[(\d+)\]\.resource\.target\[\d+\]$/.exec(ref.fieldPath);
  if (!match) return false;

  const entryIndex = Number(match[1]);
  const entries = bundle.entry;
  if (!Array.isArray(entries)) return false;
  const entryResource = toRecord(toRecord(entries[entryIndex])?.resource);
  return entryResource?.resourceType === 'Provenance';
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function getRecursiveReferenceValidator(): RecursiveReferenceValidator {
  return new RecursiveReferenceValidator();
}

export function resetRecursiveReferenceValidator(): void {
  // Compatibility no-op: validator instances are caller-owned.
}
