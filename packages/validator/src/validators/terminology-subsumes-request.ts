import axios from 'axios';
import type { CircuitBreaker } from '../terminology/index.js';
import { logger } from '../logger.js';
import { isTransientTerminologyFailure } from './terminology-api-error-policy.js';
import {
  DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS,
  getRemoteTerminologyTimeoutMs,
  recordTerminologyResponse,
} from './terminology-api-remote-policy.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { SubsumptionOutcome } from './terminology-api-types.js';
import { extractSubsumptionOutcome } from './terminology-parameters.js';
import type {
  TerminologyResolutionConfig,
  TerminologyServerOverride,
} from './valueset-types.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

interface SubsumesRequestOptions {
  cacheKey: string;
  circuitBreaker: CircuitBreaker;
  codeA: string;
  codeB: string;
  config: TerminologyResolutionConfig;
  override?: TerminologyServerOverride;
  operationCache: TerminologyOperationCache;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
  serverUrl: string;
  system: string;
}

export async function executeSubsumesRequest({
  cacheKey,
  circuitBreaker,
  codeA,
  codeB,
  config,
  override,
  operationCache,
  requestConfigBuilder,
  serverUrl,
  system,
}: SubsumesRequestOptions): Promise<SubsumptionOutcome> {
  try {
    const startedAt = Date.now();
    const response = await axios.get(
      `${serverUrl}/CodeSystem/$subsumes`,
      await requestConfigBuilder.build(
        override?.auth,
        getRemoteTerminologyTimeoutMs(
          config,
          DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS,
        ),
        {
          system,
          codeA,
          codeB,
          _format: 'json',
        },
      ),
    );

    const outcome = extractSubsumptionOutcome(response.data);
    if (outcome) {
      recordTerminologyResponse(
        circuitBreaker,
        config,
        'CodeSystem/$subsumes',
        serverUrl,
        startedAt,
      );
      operationCache.storeSubsumes(cacheKey, outcome);
      return outcome;
    }
    recordTerminologyResponse(
      circuitBreaker,
      config,
      'CodeSystem/$subsumes',
      serverUrl,
      startedAt,
    );
  } catch (error: unknown) {
    if (isTransientTerminologyFailure(error)) {
      circuitBreaker.recordFailure();
    } else {
      circuitBreaker.recordSuccess();
    }
    logger.debug(
      '[TerminologyApiClient] Server $subsumes failed',
      validationFailureMetadata(error),
    );
  }

  return 'unknown';
}
