import type { AxiosInstance } from 'axios';
import { ReferenceCircuitBreaker } from './reference-circuit-breaker.js';
import {
  createReferenceHttpClient,
  resolveBatchCheckConfig,
  type BatchCheckConfig,
  type ResolvedBatchCheckConfig,
} from './reference-http-client.js';
import { ReferenceCheckCache } from './reference-check-cache.js';
import { summarizeReferenceBatch } from './reference-batch-result.js';
import { logger } from '../logger.js';
import {
  extractBundleReferenceBatch,
  extractResourceReferenceBatch,
  parseReferenceBatch,
} from './reference-batch-input.js';
import type {
  BatchCheckResult,
  ParsedReferenceCheck,
  ReferenceExistenceCheck,
} from './reference-batch-types.js';
import { executeReferenceProbe } from './reference-probe-execution.js';

export type { BatchCheckConfig } from './reference-http-client.js';
export type { BatchCheckResult, ReferenceExistenceCheck } from './reference-batch-types.js';

export class BatchedReferenceChecker {
  private cache = new ReferenceCheckCache();
  private httpClient: AxiosInstance;
  private config: ResolvedBatchCheckConfig;
  private pendingChecks: Map<string, Promise<ReferenceExistenceCheck>> = new Map();

  private circuitBreaker = new ReferenceCircuitBreaker();

  constructor(config?: Partial<BatchCheckConfig>) {
    this.config = resolveBatchCheckConfig(config);

    logger.info('[BatchedReferenceChecker] Task 10.9: Initialized with optimized config:', {
      maxConcurrent: this.config.maxConcurrent,
      timeoutMs: this.config.timeoutMs,
      cacheTtlMs: `${this.config.cacheTtlMs / 1000 / 60}min`,
    });

    this.httpClient = createReferenceHttpClient(this.config);
  }

  async checkBatch(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    const fullConfig = { ...this.config, ...config };
    const startTime = Date.now();

    logger.info(`[BatchedReferenceChecker] Checking ${references.length} references (max concurrent: ${fullConfig.maxConcurrent})`);

    const parsedRefs = parseReferenceBatch(references);

    const uncachedRefs: ParsedReferenceCheck[] = [];
    const results: ReferenceExistenceCheck[] = [];
    let cacheHits = 0;

    for (const ref of parsedRefs) {
      if (fullConfig.enableCache) {
        const cached = this.cache.get(ref.reference, fullConfig.cacheTtlMs);
        if (cached) {
          results.push({
            reference: ref.reference,
            parseResult: ref.parseResult,
            exists: cached.exists,
            statusCode: cached.statusCode,
            fromCache: true,
            responseTimeMs: 0,
          });
          cacheHits++;
          continue;
        }
      }
      uncachedRefs.push(ref);
    }

    logger.info(`[BatchedReferenceChecker] ${cacheHits} cache hits, ${uncachedRefs.length} uncached`);

    const uncachedResults = await this.checkReferencesInParallel(
      uncachedRefs,
      fullConfig
    );

    results.push(...uncachedResults);

    const summary = summarizeReferenceBatch(results, cacheHits, startTime);

    logger.info(
      `[BatchedReferenceChecker] Complete: ${summary.existCount} exist, ${summary.notExistCount} not found, ` +
      `${summary.failedCount} failed, ${summary.cacheHitCount} cached (${summary.totalTimeMs}ms)`
    );

    return {
      results,
      ...summary,
    };
  }

  private async checkReferencesInParallel(
    refs: ParsedReferenceCheck[],
    config: ResolvedBatchCheckConfig,
  ): Promise<ReferenceExistenceCheck[]> {
    const results: ReferenceExistenceCheck[] = [];
    const maxConcurrent = config.maxConcurrent;

    for (let i = 0; i < refs.length; i += maxConcurrent) {
      const chunk = refs.slice(i, i + maxConcurrent);

      const chunkResults = await Promise.all(
        chunk.map(ref => this.checkWithDeduplication(ref.reference, ref.parseResult, config))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  private async checkWithDeduplication(
    reference: string,
    parseResult: ParsedReferenceCheck['parseResult'],
    config: ResolvedBatchCheckConfig,
  ): Promise<ReferenceExistenceCheck> {
    let pendingCheck = this.pendingChecks.get(reference);

    if (!pendingCheck) {
      pendingCheck = executeReferenceProbe({
        reference,
        parseResult,
        config,
        httpClient: this.httpClient,
        cache: this.cache,
        circuitBreaker: this.circuitBreaker,
      })
        .finally(() => {
          this.pendingChecks.delete(reference);
        });

      this.pendingChecks.set(reference, pendingCheck);
    } else {
      logger.debug('[BatchedReferenceChecker] Reusing in-flight reference check');
    }

    return pendingCheck;
  }

  public resetCircuits(): void {
    this.circuitBreaker.reset();
  }

  clearCache(): void {
    this.cache.clear();
    logger.info('[BatchedReferenceChecker] Cache cleared');
  }

  getCacheStats(): {
    size: number;
    entries: Array<{ reference: string; exists: boolean; age: number }>;
  } {
    return this.cache.getStats();
  }

  extractReferences(resource: unknown): string[] {
    return extractResourceReferenceBatch(resource);
  }

  async checkResourceReferences(
    resource: unknown,
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    const references = this.extractReferences(resource);
    return this.checkBatch(references, config);
  }

  async checkBundleReferences(
    bundle: unknown,
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    return this.checkBatch(extractBundleReferenceBatch(bundle), config);
  }

  async filterExistingReferences(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<string[]> {
    const result = await this.checkBatch(references, config);
    return result.results
      .filter(r => r.exists)
      .map(r => r.reference);
  }

  async filterNonExistingReferences(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<string[]> {
    const result = await this.checkBatch(references, config);
    return result.results
      .filter(r => !r.exists && !r.errorMessage)
      .map(r => r.reference);
  }

  async allReferencesExist(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<boolean> {
    const result = await this.checkBatch(references, config);
    return result.existCount === references.length && result.failedCount === 0;
  }

  getDeduplicationStats(): {
    pendingChecks: number;
    cacheSize: number;
    estimatedSavedRequests: number;
  } {
    return {
      pendingChecks: this.pendingChecks.size,
      cacheSize: this.cache.size,
      estimatedSavedRequests: this.pendingChecks.size,
    };
  }

  clearPendingChecks(): void {
    this.pendingChecks.clear();
  }

  getOptimizationConfig(): {
    maxConcurrent: number;
    timeoutMs: number;
    cacheTtlMs: number;
    keepAlive: boolean;
  } {
    return {
      maxConcurrent: this.config.maxConcurrent,
      timeoutMs: this.config.timeoutMs,
      cacheTtlMs: this.config.cacheTtlMs,
      keepAlive: true,
    };
  }

}

export function getBatchedReferenceChecker(config?: Partial<BatchCheckConfig>): BatchedReferenceChecker {
  return new BatchedReferenceChecker(config);
}

export function resetBatchedReferenceChecker(): void {
  // Compatibility no-op: checker instances and their caches are caller-owned.
}
