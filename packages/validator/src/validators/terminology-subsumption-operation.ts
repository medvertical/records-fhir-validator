import { logger } from '../logger.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { makeSubsumesCacheKey } from './terminology-api-cache.js';
import { getMaxConcurrentRemoteTerminologyRequests } from './terminology-api-remote-policy.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { SubsumptionOutcome } from './terminology-api-types.js';
import type { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { runSingleFlight } from './terminology-pending-requests.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';
import { executeSubsumesRequest } from './terminology-subsumes-request.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';
import type { TerminologyResolutionConfig, TerminologyServerOverride } from './valueset-types.js';

export interface TerminologySubsumptionOperationContext {
  circuitBreakers: TerminologyCircuitBreakerRegistry;
  getConfig: () => TerminologyResolutionConfig;
  operationCache: TerminologyOperationCache;
  pendingRequests: Map<string, Promise<SubsumptionOutcome>>;
  requestBroker: TerminologyRequestBroker;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
}

export async function executeRemoteSubsumption(
  context: TerminologySubsumptionOperationContext,
  input: {
    codeA: string;
    codeB: string;
    system: string;
    override?: TerminologyServerOverride;
  },
): Promise<SubsumptionOutcome> {
  const config = context.getConfig();
  if (!canDelegateCodeValidation(config)) return 'unknown';
  const serverUrl = input.override?.url ?? config.serverUrl;
  if (!serverUrl) return 'unknown';
  const serverScope = getTerminologyServerScope(
    serverUrl,
    input.override?.auth ?? config.auth,
  );

  const cacheKey = makeSubsumesCacheKey(
    serverScope,
    input.system,
    input.codeA,
    input.codeB,
  );
  const cached = context.operationCache.getSubsumes(cacheKey);
  if (cached !== undefined) {
    logger.debug('[TerminologyApiClient] $subsumes cache hit', {
      ...terminologyTargetMetadata(input.system, input.codeA, input.codeB),
      cachedResult: cached,
    });
    return cached;
  }

  return runSingleFlight(
    context.pendingRequests,
    cacheKey,
    () => logger.debug(
      '[TerminologyApiClient] $subsumes in-flight hit',
      terminologyTargetMetadata(input.system, input.codeA, input.codeB),
    ),
    async () => {
      const circuitBreaker = context.circuitBreakers.get('subsumes', serverScope);
      if (!(await circuitBreaker.allowRequest())) {
        logger.debug(
          '[TerminologyApiClient] $subsumes circuit open',
          terminologyTargetMetadata(serverUrl, input.system, input.codeA, input.codeB),
        );
        return 'unknown';
      }
      const brokerConfig = context.getConfig();
      return context.requestBroker.run(
        serverScope,
        'codesystem-subsumes',
        getMaxConcurrentRemoteTerminologyRequests(brokerConfig),
        () => executeSubsumesRequest({
          cacheKey,
          circuitBreaker,
          codeA: input.codeA,
          codeB: input.codeB,
          config: context.getConfig(),
          override: input.override,
          operationCache: context.operationCache,
          requestConfigBuilder: context.requestConfigBuilder,
          serverUrl,
          system: input.system,
        }),
      );
    },
  );
}
