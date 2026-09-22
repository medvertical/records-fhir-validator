import type { AxiosInstance } from 'axios';
import type { ReferenceCircuitBreaker } from './reference-circuit-breaker.js';
import type { ReferenceCheckCache } from './reference-check-cache.js';
import type { ResolvedBatchCheckConfig } from './reference-http-client.js';
import type { ParsedReferenceCheck, ReferenceExistenceCheck } from './reference-batch-types.js';
import { asSummaryUrl, buildReferenceProbeUrl, extractUrlHost } from './reference-probe-url.js';
import { classifyReferenceRequestFailure } from './reference-request-failure.js';

interface ReferenceProbeOptions extends ParsedReferenceCheck {
  cache: ReferenceCheckCache;
  circuitBreaker: ReferenceCircuitBreaker;
  config: ResolvedBatchCheckConfig;
  httpClient: AxiosInstance;
}

export async function executeReferenceProbe({
  reference,
  parseResult,
  cache,
  circuitBreaker,
  config,
  httpClient,
}: ReferenceProbeOptions): Promise<ReferenceExistenceCheck> {
  const startTime = Date.now();
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
  if (host && circuitBreaker.isOpen(host)) {
    return {
      reference,
      parseResult,
      exists: false,
      errorMessage: `Circuit breaker open for ${host} (degraded mode)`,
      responseTimeMs: Date.now() - startTime,
      fromCache: false,
    };
  }

  const useHead = circuitBreaker.supportsHead(host);
  try {
    const response = useHead
      ? await httpClient.head(url)
      : await httpClient.get(asSummaryUrl(url));
    let finalResponse = response;
    const responseTime = Date.now() - startTime;

    if (useHead && finalResponse.status === 405) {
      circuitBreaker.markHeadUnsupported(host);
      finalResponse = await httpClient.get(asSummaryUrl(url));
    }

    const exists = finalResponse.status >= 200 && finalResponse.status < 400;
    const isServerReachable = finalResponse.status < 500;
    if (isServerReachable && host) {
      circuitBreaker.recordSuccess(host);
    } else if (!isServerReachable && host) {
      circuitBreaker.recordFailure(host);
    }

    if (config.enableCache) {
      cache.set(reference, exists, finalResponse.status);
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
    const failure = classifyReferenceRequestFailure(error);
    if (host) circuitBreaker.recordFailure(host);

    return {
      reference,
      parseResult,
      exists: false,
      errorMessage: failure.message,
      responseTimeMs: responseTime,
      fromCache: false,
    };
  }
}
