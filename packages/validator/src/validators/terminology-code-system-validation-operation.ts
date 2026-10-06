import { logger } from '../logger.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { makeCodeSystemValidateCodeCacheKey } from './terminology-api-cache.js';
import { getMaxConcurrentRemoteTerminologyRequests } from './terminology-api-remote-policy.js';
import type { RemoteCodeSystemValidationBudget } from './terminology-api-remote-budget.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import type { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { runSingleFlight } from './terminology-pending-requests.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';
import { executeCodeSystemValidateCodeRequest } from './terminology-code-system-request.js';
import type { TerminologyResolutionConfig, TerminologyServerOverride } from './valueset-types.js';

export interface CodeSystemValidationOperationContext {
  config: TerminologyResolutionConfig;
  circuitBreakers: TerminologyCircuitBreakerRegistry;
  operationCache: TerminologyOperationCache;
  pendingRequests: Map<string, Promise<CodeSystemValidationResult>>;
  remoteBudget: RemoteCodeSystemValidationBudget;
  requestBroker: TerminologyRequestBroker;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
}

export async function validateCodeSystemRemotely(
  context: CodeSystemValidationOperationContext,
  code: string,
  system: string,
  display?: string,
  override?: TerminologyServerOverride,
  codeSystemVersion?: string,
  displayLanguage?: string,
): Promise<CodeSystemValidationResult> {
  const serverUrl = override?.url ?? context.config.serverUrl;
  if (!serverUrl) {
    logger.debug(
      '[TerminologyApiClient] No terminology server configured; skipping direct CodeSystem validation',
      terminologyTargetMetadata(system),
    );
    return {
      valid: true,
      reason: 'no-server',
      message: 'CodeSystem membership was not verified because no terminology server is configured.',
    };
  }
  const serverScope = getTerminologyServerScope(serverUrl, override?.auth ?? context.config.auth);
  const cacheKey = makeCodeSystemValidateCodeCacheKey(
    serverScope,
    system,
    code,
    display,
    codeSystemVersion,
    override?.authoritativeSnomedEdition === true,
    displayLanguage,
  );
  const cached = context.operationCache.getCodeSystemValidateCode<CodeSystemValidationResult>(cacheKey);
  if (cached) {
    logger.debug('[TerminologyApiClient] CodeSystem validate-code cache hit', terminologyTargetMetadata(system, code));
    return cached;
  }
  return runSingleFlight(
    context.pendingRequests,
    context.operationCache.contextKey?.(cacheKey) ?? cacheKey,
    () => logger.debug(
      '[TerminologyApiClient] CodeSystem validate-code in-flight hit',
      terminologyTargetMetadata(system, code),
    ),
    async () => {
      const circuitBreaker = context.circuitBreakers.get('codesystem-validate-code', serverScope);
      if (!(await circuitBreaker.allowRequest())) {
        logger.debug(
          '[TerminologyApiClient] CodeSystem $validate-code circuit open',
          terminologyTargetMetadata(serverUrl, system),
        );
        return {
          valid: true,
          reason: 'circuit-open',
          message: 'CodeSystem membership was not verified because the terminology server circuit is open.',
        };
      }
      if (!context.remoteBudget.reserve(serverUrl, context.config)) {
        return {
          valid: true,
          reason: 'remote-budget-exhausted',
          message: 'Remote CodeSystem validation budget exhausted; code/display was not verified remotely.',
        };
      }
      return context.requestBroker.run(
        serverScope,
        'codesystem-validate-code',
        getMaxConcurrentRemoteTerminologyRequests(context.config),
        () => executeCodeSystemValidateCodeRequest({
          cacheKey,
          circuitBreaker,
          code,
          codeSystemVersion,
          config: context.config,
          display,
          displayLanguage,
          override,
          operationCache: context.operationCache,
          requestConfigBuilder: context.requestConfigBuilder,
          serverUrl,
          system,
        }),
      );
    },
  );
}
