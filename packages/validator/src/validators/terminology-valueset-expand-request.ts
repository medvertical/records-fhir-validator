import axios from 'axios';
import { logger } from '../logger.js';
import type { ValueSetCache } from './valueset-cache.js';
import { isTransientTerminologyFailure } from './terminology-api-error-policy.js';
import {
  DEFAULT_VALUESET_EXPAND_TIMEOUT_MS,
  getMaxConcurrentRemoteTerminologyRequests,
  getRemoteTerminologyTimeoutMs,
  recordTerminologyResponse,
} from './terminology-api-remote-policy.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';
import type { TerminologyResolutionConfig, TerminologyServerOverride } from './valueset-types.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';

interface ValueSetExpandRequest {
  broker: TerminologyRequestBroker;
  circuitBreakers: TerminologyCircuitBreakerRegistry;
  cache: ValueSetCache;
  config: TerminologyResolutionConfig;
  override?: TerminologyServerOverride;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
  valueSetUrl: string;
}

export async function expandValueSetViaTerminologyServer({
  broker,
  circuitBreakers,
  cache,
  config,
  override,
  requestConfigBuilder,
  valueSetUrl,
}: ValueSetExpandRequest): Promise<Set<string> | null> {
  const serverUrl = override?.url ?? config.serverUrl;
  if (!serverUrl) return null;
  const serverScope = getTerminologyServerScope(serverUrl, override?.auth ?? config.auth);
  const ttlSeconds = config.serverDelegation?.cacheTTLSeconds ?? 3_600;
  const cacheKey = JSON.stringify([serverScope, valueSetUrl]);
  const cached = cache.getServerExpansion(cacheKey, ttlSeconds);
  if (cached) return cached;

  const circuitBreaker = circuitBreakers.get('valueset-expand', serverScope);
  if (!(await circuitBreaker.allowRequest())) {
    logger.debug(
      '[TerminologyApiClient] $expand circuit open',
      terminologyTargetMetadata(serverUrl, valueSetUrl),
    );
    return null;
  }

  try {
    const startedAt = Date.now();
    const response = await broker.run(
      serverScope,
      'valueset-expand',
      getMaxConcurrentRemoteTerminologyRequests(config),
      async () => axios.get(`${serverUrl}/ValueSet/$expand`, {
        ...(await requestConfigBuilder.build(
          override?.auth,
          getRemoteTerminologyTimeoutMs(config, DEFAULT_VALUESET_EXPAND_TIMEOUT_MS),
          { url: valueSetUrl, _format: 'json' },
        )),
      }),
    );
    const codes = collectExpansionCodes(response.data?.expansion?.contains);
    recordTerminologyResponse(circuitBreaker, config, '$expand', serverUrl, startedAt);
    if (!codes) return null;

    if (config.serverDelegation?.cacheResults !== false) {
      cache.setServerExpansion(cacheKey, codes);
    }
    logger.debug('[TerminologyApiClient] Server $expand succeeded', {
      ...terminologyTargetMetadata(serverUrl, valueSetUrl),
      codeCount: codes.size,
    });
    return codes;
  } catch (error: unknown) {
    if (isTransientTerminologyFailure(error)) circuitBreaker.recordFailure();
    else circuitBreaker.recordSuccess();
    logger.debug('[TerminologyApiClient] Server $expand failed', {
      ...terminologyTargetMetadata(serverUrl, valueSetUrl),
      ...validationFailureMetadata(error),
    });
    return null;
  }
}

function collectExpansionCodes(contains: unknown): Set<string> | null {
  if (!Array.isArray(contains)) return null;
  const codes = new Set<string>();
  const pending: unknown[] = [...contains];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    const concept = item as { code?: unknown; contains?: unknown; system?: unknown };
    if (typeof concept.code === 'string') {
      codes.add(concept.code);
      if (typeof concept.system === 'string') codes.add(`${concept.system}|${concept.code}`);
    }
    if (Array.isArray(concept.contains)) pending.push(...concept.contains);
  }
  return codes;
}
