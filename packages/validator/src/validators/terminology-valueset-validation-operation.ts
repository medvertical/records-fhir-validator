import { logger } from '../logger.js';
import { createHash } from 'node:crypto';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import {
  makeValidateCodeCacheKey,
  makeValueSetNotResolvableCacheKey,
} from './terminology-api-cache.js';
import { getMaxConcurrentRemoteTerminologyRequests } from './terminology-api-remote-policy.js';
import { runSingleFlight } from './terminology-pending-requests.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';
import { executeValueSetValidateCodeRequest } from './terminology-valueset-validate-code-request.js';
import type { TerminologyValueSetOperationsContext } from './terminology-valueset-operation-context.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';
import type { TerminologyServerOverride, ValueSet } from './valueset-types.js';
import type { RemoteValueSetValidationResult } from './terminology-api-types.js';

function undecided(
  reason: RemoteValueSetValidationResult['reason'],
  serverUrl: string | undefined,
  accepted = false,
): RemoteValueSetValidationResult {
  return { accepted, outcome: 'unverified', reason, ...(serverUrl ? { serverUrl } : {}) };
}

export interface RemoteValueSetValidationInput {
  code: string;
  system?: string;
  valueSetUrl: string;
  bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example';
  override?: TerminologyServerOverride;
  codeSystemVersion?: string;
  valueSet?: ValueSet;
}

export async function validateCodeAgainstRemoteValueSet(
  context: TerminologyValueSetOperationsContext,
  input: RemoteValueSetValidationInput,
): Promise<RemoteValueSetValidationResult> {
  const config = context.getConfig();
  const serverUrl = input.override?.url ?? config.serverUrl;
  if (!canDelegateCodeValidation(config)) return undecided('delegation-disabled', serverUrl);
  if (!serverUrl) return undecided('no-server', undefined);
  const serverScope = getTerminologyServerScope(
    serverUrl,
    input.override?.auth ?? config.auth,
  );

  const definitionKey = input.valueSet
    ? `${input.valueSetUrl}|definition:${createHash('sha256').update(JSON.stringify(input.valueSet)).digest('hex')}`
    : input.valueSetUrl;
  const valueSetNotResolvableKey = makeValueSetNotResolvableCacheKey(
    serverScope,
    definitionKey,
    input.system,
    input.codeSystemVersion,
  );
  if (context.operationCache.getValueSetNotResolvable(valueSetNotResolvableKey)) {
    logger.debug(
      '[TerminologyApiClient] validate-code ValueSet not-resolvable cache hit',
      terminologyTargetMetadata(input.valueSetUrl),
    );
    return undecided('value-set-not-found', serverUrl, true);
  }

  const cacheKey = makeValidateCodeCacheKey(
    serverScope,
    input.system,
    input.code,
    definitionKey,
    input.bindingStrength,
    input.codeSystemVersion,
  );
  const cached = context.operationCache.getValidateCode(cacheKey);
  if (cached !== undefined) {
    logger.debug('[TerminologyApiClient] validate-code cache hit', {
      ...terminologyTargetMetadata(input.system, input.code, input.valueSetUrl),
      cachedResult: cached,
    });
    return cached;
  }

  return runSingleFlight(
    context.pendingValidateCodeRequests,
    cacheKey,
    () => logger.debug(
      '[TerminologyApiClient] validate-code in-flight hit',
      terminologyTargetMetadata(input.system, input.code, input.valueSetUrl),
    ),
    async () => {
      const circuitBreaker = context.circuitBreakers.get(
        'valueset-validate-code',
        serverScope,
      );
      if (!(await circuitBreaker.allowRequest())) {
        logger.debug(
          '[TerminologyApiClient] $validate-code circuit open',
          terminologyTargetMetadata(serverUrl, input.system, input.code, input.valueSetUrl),
        );
        return undecided('circuit-open', serverUrl);
      }
      const requestConfig = context.getConfig();
      return executeValueSetValidateCodeRequest({
        bindingStrength: input.bindingStrength,
        cacheKey,
        circuitBreaker,
        code: input.code,
        codeSystemVersion: input.codeSystemVersion,
        config: requestConfig,
        override: input.override,
        requestConfigBuilder: context.requestConfigBuilder,
        operationCache: context.operationCache,
        serverScope,
        serverUrl,
        system: input.system,
        valueSetUrl: input.valueSetUrl,
        valueSet: input.valueSet,
        valueSetNotResolvableKey,
      }, context.requestBroker, getMaxConcurrentRemoteTerminologyRequests(requestConfig));
    },
  );
}
