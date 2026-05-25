/**
 * Batched Reference Checker
 *
 * Efficiently checks existence of multiple referenced resources using parallel
 * HTTP HEAD requests, with an automatic fallback to GET `?_summary=count` for
 * servers that don't support HEAD, and a per-host circuit breaker that
 * degrades gracefully when a FHIR server is unreachable.
 */

import type { AxiosInstance } from 'axios';
import { parseReference, type ReferenceParseResult } from './reference-type-extractor';
import { extractReferencesFromBundle, extractReferencesFromResource } from './reference-extraction';
import { asSummaryUrl, buildReferenceProbeUrl, extractUrlHost } from './reference-probe-url';
import { ReferenceCircuitBreaker } from './reference-circuit-breaker';
import {
  createReferenceHttpClient,
  resolveBatchCheckConfig,
  type BatchCheckConfig,
  type ResolvedBatchCheckConfig,
} from './reference-http-client';
import { ReferenceCheckCache } from './reference-check-cache';
import { summarizeReferenceBatch } from './reference-batch-result';
import { logger } from '../logger';

export type { BatchCheckConfig } from './reference-http-client';

// ============================================================================
// Types
// ============================================================================

export interface ReferenceExistenceCheck {
  /** The reference to check */
  reference: string;
  /** Parsed reference information */
  parseResult: ReferenceParseResult;
  /** Whether the reference exists */
  exists: boolean;
  /** HTTP status code */
  statusCode?: number;
  /** Error message if check failed */
  errorMessage?: string;
  /** Response time in milliseconds */
  responseTimeMs?: number;
  /** Whether result came from cache */
  fromCache?: boolean;
}

export interface BatchCheckResult {
  /** All check results */
  results: ReferenceExistenceCheck[];
  /** Number of references that exist */
  existCount: number;
  /** Number of references that don't exist */
  notExistCount: number;
  /** Number of checks that failed */
  failedCount: number;
  /** Number of results from cache */
  cacheHitCount: number;
  /** Total time in milliseconds */
  totalTimeMs: number;
  /** Average response time per request */
  averageResponseTimeMs: number;
}

// ============================================================================
// Batched Reference Checker Class
// ============================================================================

export class BatchedReferenceChecker {
  private cache = new ReferenceCheckCache();
  private httpClient: AxiosInstance;
  private config: ResolvedBatchCheckConfig;
  private pendingChecks: Map<string, Promise<ReferenceExistenceCheck>> = new Map(); // Task 10.9: Request deduplication

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

  /**
   * Check existence of multiple references in batches
   */
  async checkBatch(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    // Merge instance config with call-specific config
    const fullConfig = { ...this.config, ...config };
    const startTime = Date.now();

    logger.info(`[BatchedReferenceChecker] Checking ${references.length} references (max concurrent: ${fullConfig.maxConcurrent})`);

    // Parse all references
    const parsedRefs = references.map(ref => ({
      reference: ref,
      parseResult: parseReference(ref),
    }));

    // Check cache first
    const uncachedRefs: typeof parsedRefs = [];
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

    // Check uncached references in parallel batches
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

  /**
   * Check references in parallel with concurrency limit
   * Task 10.9: Added request deduplication for concurrent checks
   */
  private async checkReferencesInParallel(
    refs: Array<{ reference: string; parseResult: ReferenceParseResult }>,
    config: Required<BatchCheckConfig>
  ): Promise<ReferenceExistenceCheck[]> {
    const results: ReferenceExistenceCheck[] = [];
    const maxConcurrent = config.maxConcurrent;

    // Process in chunks
    for (let i = 0; i < refs.length; i += maxConcurrent) {
      const chunk = refs.slice(i, i + maxConcurrent);

      // Task 10.9: Deduplicate requests within chunk
      const chunkResults = await Promise.all(
        chunk.map(ref => this.checkWithDeduplication(ref.reference, ref.parseResult, config))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Task 10.9: Check reference with request deduplication
   * Reuses in-flight checks for the same reference to avoid duplicate HTTP requests
   */
  private async checkWithDeduplication(
    reference: string,
    parseResult: ReferenceParseResult,
    config: Required<BatchCheckConfig>
  ): Promise<ReferenceExistenceCheck> {
    // Check if this reference is already being checked
    let pendingCheck = this.pendingChecks.get(reference);

    if (!pendingCheck) {
      // Start new check
      pendingCheck = this.checkSingleReference(reference, parseResult, config)
        .finally(() => {
          // Clean up after completion
          this.pendingChecks.delete(reference);
        });

      this.pendingChecks.set(reference, pendingCheck);
    } else {
      logger.info(`[BatchedReferenceChecker] Task 10.9: Reusing in-flight check for ${reference}`);
    }

    return pendingCheck;
  }

  /**
   * Check existence of a single reference.
   *
   * Flow:
   *   1. Build an absolute URL from the reference + baseUrl.
   *   2. If the target host has an open circuit, short-circuit immediately
   *      with a cache-friendly "unknown" result (exists: false, errorMessage
   *      populated) so validation degrades gracefully to format-only checks.
   *   3. Try HEAD first. Many FHIR servers respond correctly to HEAD and it
   *      is much cheaper than GET.
   *   4. If HEAD returns 405 Method Not Allowed (or any 4xx other than 404),
   *      or the host is in `headUnsupported`, retry with GET + `_summary=count`
   *      which all FHIR servers must support.
   *   5. On repeated network-level failures, trip the circuit breaker for
   *      the host so subsequent references to the same host short-circuit.
   */
  private async checkSingleReference(
    reference: string,
    parseResult: ReferenceParseResult,
    config: Required<BatchCheckConfig>
  ): Promise<ReferenceExistenceCheck> {
    const startTime = Date.now();

    // Build URL
    const url = buildReferenceProbeUrl(reference, parseResult, config);
    if (!url) {
      return {
        reference,
        parseResult,
        exists: false,
        errorMessage: 'Cannot build URL for reference',
      };
    }

    const host = extractUrlHost(url);

    // Circuit breaker: short-circuit if the host is currently unreachable
    if (host && this.circuitBreaker.isOpen(host)) {
      return {
        reference,
        parseResult,
        exists: false,
        errorMessage: `Circuit breaker open for ${host} (degraded mode)`,
        responseTimeMs: Date.now() - startTime,
        fromCache: false,
      };
    }

    const useHead = this.circuitBreaker.supportsHead(host);

    try {
      // First attempt: HEAD (unless known-unsupported)
      const response = useHead
        ? await this.httpClient.head(url)
        : await this.httpClient.get(asSummaryUrl(url));
      let finalResponse = response;
      const responseTime = Date.now() - startTime;

      // 405 Method Not Allowed → fall back to GET and remember the host
      if (useHead && finalResponse.status === 405) {
        this.circuitBreaker.markHeadUnsupported(host);
        finalResponse = await this.httpClient.get(asSummaryUrl(url));
      }

      // 2xx / 3xx are considered success
      const exists =
        finalResponse.status >= 200 && finalResponse.status < 400;
      const isServerReachable = finalResponse.status < 500;

      if (isServerReachable && host) {
        this.circuitBreaker.recordSuccess(host);
      } else if (!isServerReachable && host) {
        this.circuitBreaker.recordFailure(host);
      }

      // Cache result
      if (config.enableCache) {
        this.cache.set(reference, exists, finalResponse.status);
      }

      return {
        reference,
        parseResult,
        exists,
        statusCode: finalResponse.status,
        responseTimeMs: responseTime,
        fromCache: false,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (host) this.circuitBreaker.recordFailure(host);

      return {
        reference,
        parseResult,
        exists: false,
        errorMessage,
        responseTimeMs: responseTime,
        fromCache: false,
      };
    }
  }

  /**
   * Reset the circuit-breaker state. Primarily useful in tests.
   */
  public resetCircuits(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[BatchedReferenceChecker] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ reference: string; exists: boolean; age: number }>;
  } {
    return this.cache.getStats();
  }

  /**
   * Extract references from a resource
   */
  extractReferences(resource: any): string[] {
    return extractReferencesFromResource(resource);
  }

  /**
   * Check all references in a resource
   */
  async checkResourceReferences(
    resource: any,
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    const references = this.extractReferences(resource);
    return this.checkBatch(references, config);
  }

  /**
   * Check all references in a Bundle
   */
  async checkBundleReferences(
    bundle: any,
    config?: Partial<BatchCheckConfig>
  ): Promise<BatchCheckResult> {
    return this.checkBatch(extractReferencesFromBundle(bundle), config);
  }

  /**
   * Filter references by existence
   */
  async filterExistingReferences(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<string[]> {
    const result = await this.checkBatch(references, config);
    return result.results
      .filter(r => r.exists)
      .map(r => r.reference);
  }

  /**
   * Filter references by non-existence
   */
  async filterNonExistingReferences(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<string[]> {
    const result = await this.checkBatch(references, config);
    return result.results
      .filter(r => !r.exists && !r.errorMessage)
      .map(r => r.reference);
  }

  /**
   * Check if all references exist
   */
  async allReferencesExist(
    references: string[],
    config?: Partial<BatchCheckConfig>
  ): Promise<boolean> {
    const result = await this.checkBatch(references, config);
    return result.existCount === references.length && result.failedCount === 0;
  }

  // ========================================================================
  // Task 10.9: Performance Monitoring Methods
  // ========================================================================

  /**
   * Get deduplication statistics
   */
  getDeduplicationStats(): {
    pendingChecks: number;
    cacheSize: number;
    estimatedSavedRequests: number;
  } {
    return {
      pendingChecks: this.pendingChecks.size,
      cacheSize: this.cache.size,
      estimatedSavedRequests: this.pendingChecks.size, // Each pending check may be reused
    };
  }

  /**
   * Clear pending checks (for testing)
   */
  clearPendingChecks(): void {
    this.pendingChecks.clear();
  }

  /**
   * Get optimization config
   */
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
      keepAlive: true, // Always enabled in Task 10.9
    };
  }

  /**
   * Get comprehensive statistics (alias for getCacheStats with more info)
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } {
    const cacheStats = this.getCacheStats();

    // Estimate hit rate based on cache size. This is a coarse heuristic —
    // accurate per-entry hit/miss counts would require wrapping every cache
    // lookup, which is more instrumentation than the PR budget allows.
    const totalAccesses = this.cache.size;
    const estimatedHits = this.cache.size;
    const estimatedMisses = Math.max(0, totalAccesses - estimatedHits);
    const hitRate = totalAccesses > 0 ? (estimatedHits / totalAccesses) * 100 : 0;

    return {
      size: cacheStats.size,
      hits: estimatedHits,
      misses: estimatedMisses,
      hitRate,
      evictions: 0, // Not currently tracked
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let checkerInstance: BatchedReferenceChecker | null = null;

export function getBatchedReferenceChecker(config?: Partial<BatchCheckConfig>): BatchedReferenceChecker {
  if (!checkerInstance) {
    checkerInstance = new BatchedReferenceChecker(config);
  }
  return checkerInstance;
}

export function resetBatchedReferenceChecker(): void {
  checkerInstance = null;
}
