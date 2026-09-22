/**
 * Batch Validator
 * 
 * Handles batch validation orchestration.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { ProfileApplicationSource, ValidationAspectType, ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { FhirClientLike } from './profile-loader-utils.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { ProfileCache } from '../cache/profile-cache.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import { logger } from '../logger.js';
import {
  deduplicateResources,
  groupResourcesByProfile,
} from './batch-resource-planning.js';
import { preloadProfiles } from './profile-batch-preloader.js';
import { createValidationErrorIssue as _createValidationErrorIssue } from './validation-utils.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import { operationalResourceReference } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import type { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';
import { isRecord, resourceIdOf, resourceTypeOf } from './fhir-resource.js';

export interface BatchValidationOptions {
  fhirVersion?: 'R4' | 'R5' | 'R6';
  maxConcurrency?: number;
  profileUrl?: string;
  /** Original selection source for each input resource, before host profile materialization. */
  profileSources?: ProfileApplicationSource[];
  aspects?: ValidationAspectType[];
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
  referenceResolver?: ReferenceResolver;
  organizationId?: number;
  serverId?: number;
  runtimeScopeKey?: string;
  onResourceValidated?: (resource: Record<string, unknown>, result: unknown) => void | Promise<void>;
  onEmbeddedResourceValidated?: (resource: Record<string, unknown>, result: unknown) => void | Promise<void>;
  shouldStop?: () => boolean;
  scheduleValidation?: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface BatchValidatorContext<T = ValidationIssue[]> {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  profileWarmupCoordinator?: ProfileWarmupCoordinator;
  validateResource: (resource: unknown, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<T>;
}

type AspectTimingResult = {
  aspects?: Array<{
    aspect?: string;
    validationTime?: number;
    issues?: unknown[];
  }>;
};

export class BatchValidationAbortedError extends Error {
  constructor() {
    super('Batch validation stopped');
    this.name = 'BatchValidationAbortedError';
  }
}

export function isBatchValidationAbortedError(error: unknown): error is BatchValidationAbortedError {
  return error instanceof BatchValidationAbortedError ||
    (error instanceof Error && error.name === 'BatchValidationAbortedError');
}

function throwIfBatchStopped(options: BatchValidationOptions): void {
  if (options.shouldStop?.()) {
    throw new BatchValidationAbortedError();
  }
}

/**
 * Execute batch validation
 */
export async function executeBatchValidation<T = ValidationIssue[]>(
  resources: unknown[],
  options: BatchValidationOptions,
  context: BatchValidatorContext<T>
): Promise<Map<unknown, T>> {
  if (options.profileSources && options.profileSources.length !== resources.length) {
    throw new Error('Profile sources must match the input resource count');
  }
  const fhirVersion = options.fhirVersion || 'R4';
  const maxConcurrency = options.maxConcurrency || 10;
  const profileSourceContext: ProfileSourceContext = {
    organizationId: options.organizationId,
    serverId: options.serverId,
    fhirVersion,
  };

  context.sdLoader.setProfileResolutionContext(profileSourceContext, options.settings);

  logger.info(`[RecordsValidator] ⚡ Starting batch validation of ${resources.length} resources (concurrency: ${maxConcurrency})`);

  try {
    throwIfBatchStopped(options);

    // Step 1: Deduplicate resources by content hash
    const dedupStart = Date.now();
    const { unique, duplicateMap } = deduplicateResources(resources, options.profileSources);
    const dedupTime = Date.now() - dedupStart;
    logger.info(`[RecordsValidator] ✓ Deduplicated in ${dedupTime}ms: ${resources.length} → ${unique.length} unique resources`);

    // Step 2: Group resources by profile URL for efficient profile loading
    const groupStart = Date.now();
    const groupedByProfile = groupResourcesByProfile(unique, options.profileUrl);
    const groupTime = Date.now() - groupStart;
    logger.info(`[RecordsValidator] ✓ Grouped in ${groupTime}ms into ${groupedByProfile.size} profile(s)`);

    // Step 3: Pre-load all required profiles in parallel
    const preloadStart = Date.now();
    throwIfBatchStopped(options);
    const profileUrls = Array.from(groupedByProfile.keys());
    await preloadProfiles(
      context.sdLoader,
      context.profileCache,
      context.snapshotGenerator,
      profileUrls,
      fhirVersion,
      options.fhirClient,
      options.settings,
      profileSourceContext,
      context.profileWarmupCoordinator,
    );
    const preloadTime = Date.now() - preloadStart;
    logger.info(`[RecordsValidator] ✓ Pre-loaded ${profileUrls.length} profile(s) in ${preloadTime}ms`);

    // Step 4: Validate all resources with one bounded worker pool. Profiles
    // are already preloaded, so serial profile groups and lock-step chunks only
    // create head-of-line blocking when one resource is slower than its peers.
    const { resultsMap, validationTime } = await validateBatchWorkItems(
      groupedByProfile,
      fhirVersion,
      maxConcurrency,
      options,
      context,
    );
    logger.info(`[RecordsValidator] ✓ All validations complete in ${validationTime}ms`);

    // Step 5: Fan out results to duplicate resources
    const fanoutStart = Date.now();
    let fanoutCount = 0;
    for (const [_hash, duplicates] of duplicateMap.entries()) {
      const firstResource = duplicates[0];
      const result = resultsMap.get(firstResource);

      if (result) {
        // Copy issues to all duplicates
        for (let i = 1; i < duplicates.length; i++) {
          resultsMap.set(duplicates[i], result);
          fanoutCount++;
        }
      }
    }
    const fanoutTime = Date.now() - fanoutStart;
    if (fanoutCount > 0) {
      logger.info(`[RecordsValidator] ✓ Fanned out results to ${fanoutCount} duplicates in ${fanoutTime}ms`);
    }

    const totalTime = Date.now() - dedupStart;
    const avgTime = totalTime / resources.length;

    // Detailed timing breakdown
    logger.info(`[RecordsValidator] ⚡ Batch validation complete in ${totalTime}ms (avg ${avgTime.toFixed(2)}ms/resource)`);
    logger.info(`[RecordsValidator] 📊 Timing breakdown:`);
    logger.info(`[RecordsValidator]   - Deduplication: ${dedupTime}ms (${(dedupTime / totalTime * 100).toFixed(1)}%)`);
    logger.info(`[RecordsValidator]   - Grouping: ${groupTime}ms (${(groupTime / totalTime * 100).toFixed(1)}%)`);
    logger.info(`[RecordsValidator]   - Profile loading: ${preloadTime}ms (${(preloadTime / totalTime * 100).toFixed(1)}%)`);
    logger.info(`[RecordsValidator]   - Validation: ${validationTime}ms (${(validationTime / totalTime * 100).toFixed(1)}%)`);
    logger.info(`[RecordsValidator]   - Fanout: ${fanoutTime}ms (${(fanoutTime / totalTime * 100).toFixed(1)}%)`);

    return resultsMap;

  } catch (error) {
    if (isBatchValidationAbortedError(error)) {
      logger.info('[RecordsValidator] Batch validation stopped before completion');
      throw error;
    }

    logger.error('[RecordsValidator] Batch validation error', validationFailureMetadata(error));

    // Return error results for all resources
    const resultsMap = new Map<unknown, T>();
    // Note: We can't generate a generic error T here easily.
    // So we'll iterate and try to assume ValidationIssue[] if T is not specified, 
    // or just rethrow if we can't be sure?
    // For backward compatibility, if T is ValidationIssue[], we can return ValidationIssue[].
    // But we don't know T at runtime.
    // The previous code returned ValidationIssue[].
    // Best effort: throw error if we can't return T.

    if (resources.length > 0) {
      // It's safer to just throw the error back to the caller in this generic context
      // OR return an empty map and let caller handle.
      // But the original code returned a Map with error issues.
      throw error;
    }

    return resultsMap;
  }
}

async function validateBatchWorkItems<T>(
  groupedByProfile: Map<string, unknown[]>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  maxConcurrency: number,
  options: BatchValidationOptions,
  context: BatchValidatorContext<T>,
): Promise<{ resultsMap: Map<unknown, T>; validationTime: number }> {
  const validationStart = Date.now();
  const resultsMap = new Map<unknown, T>();
  const workItems = Array.from(groupedByProfile.entries()).flatMap(
    ([profileUrl, resourceGroup]) => resourceGroup.map(resource => ({ profileUrl, resource })),
  );
  let nextWorkIndex = 0;
  let workerFailed = false;
  const workerCount = Math.min(Math.max(1, maxConcurrency), workItems.length);

  const runWorker = async () => {
    while (!workerFailed) {
      throwIfBatchStopped(options);
      const workIndex = nextWorkIndex++;
      if (workIndex >= workItems.length) return;
      const { resource, profileUrl } = workItems[workIndex];
      const resourceStart = Date.now();

      try {
        const validate = () => {
          throwIfBatchStopped(options);
          if (workerFailed) throw new BatchValidationAbortedError();
          return context.validateResource(resource, profileUrl, fhirVersion);
        };
        const result = options.scheduleValidation
          ? await options.scheduleValidation(validate)
          : await validate();
        throwIfBatchStopped(options);
        if (workerFailed) return;
        const resourceTime = Date.now() - resourceStart;

        if (resourceTime > 500) {
          const aspectBreakdown = formatAspectTimingBreakdown(result);
          logger.warn('[RecordsValidator] Slow validation', {
            ...operationalResourceReference(resourceTypeOf(resource), resourceIdOf(resource)),
            durationMs: resourceTime,
            ...(aspectBreakdown ? { aspectBreakdown } : {}),
          });
        }

        resultsMap.set(resource, result);
        if (options.onResourceValidated && isRecord(resource)) {
          await options.onResourceValidated(resource, result);
        }
      } catch (error) {
        workerFailed = true;
        throw error;
      }
    }
  };

  const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, runWorker));
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  throwIfBatchStopped(options);
  return { resultsMap, validationTime: Date.now() - validationStart };
}

function formatAspectTimingBreakdown(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const aspects = (result as AspectTimingResult).aspects;
  if (!Array.isArray(aspects) || aspects.length === 0) return null;

  return aspects
    .map((aspect) => ({
      name: aspect.aspect || 'unknown',
      time: Number(aspect.validationTime ?? 0),
      issues: Array.isArray(aspect.issues) ? aspect.issues.length : 0,
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 4)
    .map((aspect) => `${aspect.name}=${aspect.time}ms/${aspect.issues} issues`)
    .join(', ');
}
