import axios, { isAxiosError } from 'axios';

import { logger } from '../logger.js';
import type { CircuitBreaker } from '../terminology/index.js';
import {
  DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS,
  getRemoteTerminologyTimeoutMs,
  recordTerminologyResponse,
} from './terminology-api-remote-policy.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import {
  operationOutcomeCannotResolveBinding,
  valueSetValidationOutcome,
} from './terminology-parameters.js';
import type { TerminologyResolutionConfig, TerminologyServerOverride, ValueSet } from './valueset-types.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';
import type { RemoteValueSetValidationResult } from './terminology-api-types.js';

interface ValueSetValidateCodeRequest {
  bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example';
  cacheKey: string;
  circuitBreaker: CircuitBreaker;
  code: string;
  codeSystemVersion?: string;
  config: TerminologyResolutionConfig;
  override?: TerminologyServerOverride;
  operationCache: TerminologyOperationCache;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
  serverScope: string;
  serverUrl: string;
  system?: string;
  valueSetUrl: string;
  valueSet?: ValueSet;
  valueSetNotResolvableKey: string;
}

export async function executeValueSetValidateCodeRequest(
  request: ValueSetValidateCodeRequest,
  broker: TerminologyRequestBroker,
  maxConcurrency: number,
): Promise<RemoteValueSetValidationResult> {
  const {
    bindingStrength,
    cacheKey,
    circuitBreaker,
    code,
    codeSystemVersion,
    config,
    override,
    operationCache,
    requestConfigBuilder,
    serverScope,
    serverUrl,
    system,
    valueSetUrl,
    valueSet,
  } = request;
  try {
    const [canonical, valueSetVersion] = valueSetUrl.split('|');
    const params: Record<string, string> = { url: canonical, code, _format: 'json' };
    if (valueSetVersion) params.valueSetVersion = valueSetVersion;
    // A binding on a string or code element carries no system. The server
    // infers it from the value set; without the flag it rejects the request
    // as incomplete instead of answering.
    if (system) params.system = system;
    else params.inferSystem = 'true';
    if (codeSystemVersion) params.systemVersion = codeSystemVersion;
    let startedAt = Date.now();
    const response = await broker.run(
      serverScope,
      'valueset-validate-code',
      maxConcurrency,
      async () => {
        startedAt = Date.now();
        if (valueSet) {
          const requestConfig = await requestConfigBuilder.build(
            override?.auth,
            getRemoteTerminologyTimeoutMs(config, DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS),
          );
          return axios.post(`${serverUrl}/ValueSet/$validate-code`, {
            resourceType: 'Parameters', parameter: [
              { name: 'code', valueCode: code },
              ...(system ? [{ name: 'system', valueUri: system }] : [{ name: 'inferSystem', valueBoolean: true }]),
              ...(codeSystemVersion ? [{ name: 'systemVersion', valueString: codeSystemVersion }] : []),
              { name: 'valueSet', resource: valueSet },
            ],
          }, { ...requestConfig, headers: { ...requestConfig.headers, 'Content-Type': 'application/fhir+json' } });
        }
        return axios.get(`${serverUrl}/ValueSet/$validate-code`, {
          ...(await requestConfigBuilder.build(
            override?.auth,
            getRemoteTerminologyTimeoutMs(config, DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS),
            params,
          )),
        });
      },
    );

    const outcome = valueSetValidationOutcome(response.data);
    const result: RemoteValueSetValidationResult = {
      accepted: outcome === 'valid',
      outcome,
      serverUrl,
      // An undecidable 200 carries no binding answer the server would stand behind.
      ...(outcome === 'unverified' ? { reason: 'value-set-not-found' as const } : {}),
    };
    recordTerminologyResponse(
      circuitBreaker,
      config,
      'ValueSet/$validate-code',
      serverUrl,
      startedAt,
    );
    operationCache.storeValidateCode(cacheKey, result);
    return result;
  } catch (error: unknown) {
    const axiosResponse = isAxiosError(error) ? error.response : undefined;
    logger.debug('[TerminologyApiClient] Server $validate-code failed', {
      ...validationFailureMetadata(error),
      ...(typeof axiosResponse?.status === 'number' ? { status: axiosResponse.status } : {}),
      hasResponseData: axiosResponse?.data !== undefined,
    });
    if (axiosResponse?.status === 422 || axiosResponse?.status === 404) {
      circuitBreaker.recordSuccess();
      const cannotResolve = operationOutcomeCannotResolveBinding(axiosResponse.data);
      const failOpen = cannotResolve || bindingStrength !== 'required';
      if (cannotResolve) {
        operationCache.storeValueSetNotResolvable(
          request.valueSetNotResolvableKey,
        );
      }
      const result: RemoteValueSetValidationResult = {
        accepted: failOpen,
        outcome: cannotResolve ? 'unverified' : 'invalid',
        serverUrl,
        ...(cannotResolve ? { reason: 'value-set-not-found' as const } : {}),
      };
      operationCache.storeValidateCode(cacheKey, result);
      return result;
    }
    circuitBreaker.recordFailure();
    return { accepted: false, outcome: 'unverified', reason: 'server-failure', serverUrl };
  }
}
