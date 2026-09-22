import axios, { isAxiosError } from 'axios';
import type { CircuitBreaker } from '../terminology/index.js';
import { logger } from '../logger.js';
import {
  buildSnomedNationalExtensionUnverifiedResult,
  isSnomedNationalExtensionSystemCode,
  operationOutcomeToCodeSystemResult,
  parseCodeSystemValidationParameters,
} from './terminology-code-system-result.js';
import {
  DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS,
  getRemoteTerminologyTimeoutMs,
  recordTerminologyResponse,
} from './terminology-api-remote-policy.js';
import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import type {
  TerminologyResolutionConfig,
  TerminologyServerOverride,
} from './valueset-types.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

interface CodeSystemValidationRequestOptions {
  cacheKey: string;
  circuitBreaker: CircuitBreaker;
  code: string;
  codeSystemVersion?: string;
  config: TerminologyResolutionConfig;
  display?: string;
  override?: TerminologyServerOverride;
  operationCache: TerminologyOperationCache;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
  serverUrl: string;
  system: string;
}

function handleCodeSystemValidationError(
  circuitBreaker: CircuitBreaker,
  error: unknown,
  code: string,
  system: string,
  authoritativeSnomedEdition: boolean,
): CodeSystemValidationResult {
  const axiosResponse = isAxiosError(error) ? error.response : undefined;

  if (axiosResponse?.status === 422 || axiosResponse?.status === 404) {
    circuitBreaker.recordSuccess();
    if (isSnomedNationalExtensionSystemCode(system, code) && !authoritativeSnomedEdition) {
      logger.debug(
        '[TerminologyApiClient] SNOMED national-extension code could not be verified; failing open',
        {
          ...terminologyTargetMetadata(system, code),
          status: axiosResponse.status,
        },
      );
      return buildSnomedNationalExtensionUnverifiedResult(code, system);
    }
    return operationOutcomeToCodeSystemResult(axiosResponse.data, code, system);
  }

  circuitBreaker.recordFailure();
  logger.warn('[TerminologyApiClient] CodeSystem validation failed', {
    ...validationFailureMetadata(error),
    ...(typeof axiosResponse?.status === 'number' ? { status: axiosResponse.status } : {}),
  });
  return { valid: true };
}

export async function executeCodeSystemValidateCodeRequest({
  cacheKey,
  circuitBreaker,
  code,
  codeSystemVersion,
  config,
  display,
  override,
  operationCache,
  requestConfigBuilder,
  serverUrl,
  system,
}: CodeSystemValidationRequestOptions): Promise<CodeSystemValidationResult> {
  try {
    const params = {
      url: system,
      code,
      ...(codeSystemVersion ? { version: codeSystemVersion } : {}),
      ...(display ? { display } : {}),
      _format: 'json',
    };

    logger.debug(
      '[TerminologyApiClient] Validating code in CodeSystem',
      terminologyTargetMetadata(serverUrl, system, code),
    );

    const startedAt = Date.now();
    const response = await axios.get(
      `${serverUrl}/CodeSystem/$validate-code`,
      await requestConfigBuilder.build(
        override?.auth,
        getRemoteTerminologyTimeoutMs(
          config,
          DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS,
        ),
        params,
      ),
    );

    recordTerminologyResponse(
      circuitBreaker,
      config,
      'CodeSystem/$validate-code',
      serverUrl,
      startedAt,
    );
    const result = parseCodeSystemValidationParameters(
      response.data,
      code,
      system,
      { authoritativeSnomedEdition: override?.authoritativeSnomedEdition },
    );
    operationCache.storeCodeSystemValidateCode(cacheKey, result);
    return result;
  } catch (error: unknown) {
    const result = handleCodeSystemValidationError(
      circuitBreaker,
      error,
      code,
      system,
      override?.authoritativeSnomedEdition === true,
    );
    const axiosResponse = isAxiosError(error) ? error.response : undefined;
    if (axiosResponse?.status === 422 || axiosResponse?.status === 404) {
      operationCache.storeCodeSystemValidateCode(cacheKey, result);
    }
    return result;
  }
}
