/**
 * Batch Validator
 * 
 * Handles batch validation orchestration.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { ValidationAspectType, ValidationIssue, ValidationSettings } from '../types';
import type { FhirClientLike } from './profile-loader-utils.js';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { ProfileCache } from '../cache/profile-cache';
import type { SnapshotGenerator } from './snapshot-generator';
import { logger } from '../logger';
import {
  deduplicateResources,
  groupResourcesByProfile,
  preloadProfiles,
  chunkArray
} from './batch-utils';
import { createValidationErrorIssue as _createValidationErrorIssue } from './validation-utils';

export interface BatchValidationOptions {
  fhirVersion?: 'R4' | 'R5' | 'R6';
  maxConcurrency?: number;
  profileUrl?: string;
  aspects?: ValidationAspectType[];
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
  organizationId?: number;
  onResourceValidated?: (resource: any, result: unknown) => void | Promise<void>;
}

export interface BatchValidatorContext<T = ValidationIssue[]> {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  validateResource: (resource: any, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<T>;
}

type AspectTimingResult = {
  aspects?: Array<{
    aspect?: string;
    validationTime?: number;
    issues?: unknown[];
  }>;
};

/**
 * Execute batch validation
 */
// eslint-disable-next-line max-lines-per-function
export async function executeBatchValidation<T = ValidationIssue[]>(
  resources: any[],
  options: BatchValidationOptions,
  context: BatchValidatorContext<T>
): Promise<Map<any, T>> {
  const fhirVersion = options.fhirVersion || 'R4';
  const maxConcurrency = options.maxConcurrency || 10;

  logger.info(`[RecordsValidator] ⚡ Starting batch validation of ${resources.length} resources (concurrency: ${maxConcurrency})`);

  try {
    // Step 1: Deduplicate resources by content hash
    const dedupStart = Date.now();
    const { unique, duplicateMap } = deduplicateResources(resources);
    const dedupTime = Date.now() - dedupStart;
    logger.info(`[RecordsValidator] ✓ Deduplicated in ${dedupTime}ms: ${resources.length} → ${unique.length} unique resources`);

    // Step 2: Group resources by profile URL for efficient profile loading
    const groupStart = Date.now();
    const groupedByProfile = groupResourcesByProfile(unique, options.profileUrl);
    const groupTime = Date.now() - groupStart;
    logger.info(`[RecordsValidator] ✓ Grouped in ${groupTime}ms into ${groupedByProfile.size} profile(s)`);

    // Step 3: Pre-load all required profiles in parallel
    const preloadStart = Date.now();
    const profileUrls = Array.from(groupedByProfile.keys());
    await preloadProfiles(
      context.sdLoader,
      context.profileCache,
      context.snapshotGenerator,
      profileUrls,
      fhirVersion,
      options.fhirClient,
      options.settings
    );
    const preloadTime = Date.now() - preloadStart;
    logger.info(`[RecordsValidator] ✓ Pre-loaded ${profileUrls.length} profile(s) in ${preloadTime}ms`);

    // Step 4: Validate resources in parallel (by profile group)
    const validationStart = Date.now();
    const resultsMap = new Map<any, T>();

    for (const [profileUrl, resourceGroup] of groupedByProfile.entries()) {
      const groupValidationStart = Date.now();
      logger.info(`[RecordsValidator] 🔄 Validating ${resourceGroup.length} resources against ${profileUrl}...`);

      // Process resources in chunks for this profile
      const chunks = chunkArray(resourceGroup, maxConcurrency);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const chunkStart = Date.now();

        const chunkPromises = chunk.map(async (resource) => {
          const resourceStart = Date.now();
          const result = await context.validateResource(resource, profileUrl, fhirVersion);
          const resourceTime = Date.now() - resourceStart;

          if (resourceTime > 500) {
            const aspectBreakdown = formatAspectTimingBreakdown(result);
            logger.warn(
              `[RecordsValidator] ⚠️  Slow validation: ${resource.resourceType}/${resource.id} took ${resourceTime}ms` +
              (aspectBreakdown ? ` (${aspectBreakdown})` : '')
            );
          }

          resultsMap.set(resource, result);
          if (options.onResourceValidated) {
            await options.onResourceValidated(resource, result);
          }
        });

        await Promise.all(chunkPromises);

        const chunkTime = Date.now() - chunkStart;
        logger.debug(`[RecordsValidator]   - Chunk ${chunkIndex + 1}/${chunks.length}: ${chunkTime}ms (${chunk.length} resources)`);
      }

      const groupValidationTime = Date.now() - groupValidationStart;
      logger.info(`[RecordsValidator] ✓ Profile group complete in ${groupValidationTime}ms (avg ${(groupValidationTime / resourceGroup.length).toFixed(2)}ms/resource)`);
    }

    const validationTime = Date.now() - validationStart;
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
    logger.error('[RecordsValidator] Batch validation error:', error);

    // Return error results for all resources
    const resultsMap = new Map<any, T>();
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
