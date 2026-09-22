import type { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type { RemoteValueSetValidationResult } from './terminology-api-types.js';
import type { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { TerminologyResolutionConfig } from './valueset-types.js';

export interface TerminologyValueSetOperationsContext {
  cache: ValueSetCache;
  circuitBreakers: TerminologyCircuitBreakerRegistry;
  getConfig: () => TerminologyResolutionConfig;
  operationCache: TerminologyOperationCache;
  pendingValidateCodeRequests: Map<string, Promise<RemoteValueSetValidationResult>>;
  requestBroker: TerminologyRequestBroker;
  requestConfigBuilder: TerminologyRequestConfigBuilder;
}
