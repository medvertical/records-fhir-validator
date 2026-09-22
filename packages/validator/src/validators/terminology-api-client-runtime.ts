import type { CodeSystemValidationOperationContext } from './terminology-code-system-validation-operation.js';
import { RemoteCodeSystemValidationBudget } from './terminology-api-remote-budget.js';
import { TerminologyRequestConfigBuilder } from './terminology-api-request-config.js';
import type {
  CodeSystemValidationResult,
  RemoteValueSetValidationResult,
  SubsumptionOutcome,
} from './terminology-api-types.js';
import { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import { TerminologyOperationCache } from './terminology-operation-cache.js';
import {
  sharedTerminologyRequestBroker,
  type TerminologyRequestBroker,
} from './terminology-request-broker.js';
import type { TerminologySubsumptionOperationContext } from './terminology-subsumption-operation.js';
import {
  snapshotTerminologyConfig,
  terminologyAuthConfigsEqual,
  terminologyConfigsEqual,
} from './terminology-config-snapshot.js';
import type { TerminologyValueSetOperationsContext } from './terminology-valueset-operations.js';
import { ValueSetCache } from './valueset-cache.js';
import type { TerminologyResolutionConfig } from './valueset-types.js';

/** Owns mutable request state shared by terminology API operations. */
export class TerminologyApiClientRuntime {
  private config: TerminologyResolutionConfig;
  private readonly requestConfigBuilder = new TerminologyRequestConfigBuilder(
    () => this.config.auth,
  );
  private readonly remoteCodeSystemBudget = new RemoteCodeSystemValidationBudget();
  private readonly pendingValidateCodeRequests = new Map<
    string,
    Promise<RemoteValueSetValidationResult>
  >();
  private readonly pendingSubsumesRequests = new Map<string, Promise<SubsumptionOutcome>>();
  private readonly pendingCodeSystemValidateCodeRequests = new Map<
    string,
    Promise<CodeSystemValidationResult>
  >();

  constructor(
    config: TerminologyResolutionConfig,
    private readonly cache: ValueSetCache = new ValueSetCache(),
    private readonly operationCache: TerminologyOperationCache = new TerminologyOperationCache(),
    private readonly circuitBreakers = new TerminologyCircuitBreakerRegistry(),
    private readonly requestBroker: TerminologyRequestBroker = sharedTerminologyRequestBroker,
  ) {
    this.config = snapshotTerminologyConfig(config);
  }

  setConfig(config: TerminologyResolutionConfig): void {
    const nextConfig = snapshotTerminologyConfig(config);
    if (terminologyConfigsEqual(this.config, nextConfig)) return;
    const authChanged = !terminologyAuthConfigsEqual(this.config.auth, nextConfig.auth);
    this.config = nextConfig;
    if (authChanged) this.requestConfigBuilder.resetAuthCache();
    this.remoteCodeSystemBudget.reset();
  }

  getConfig(): TerminologyResolutionConfig {
    return this.config;
  }

  valueSetOperationsContext(): TerminologyValueSetOperationsContext {
    return {
      cache: this.cache,
      circuitBreakers: this.circuitBreakers,
      getConfig: () => this.config,
      operationCache: this.operationCache,
      pendingValidateCodeRequests: this.pendingValidateCodeRequests,
      requestBroker: this.requestBroker,
      requestConfigBuilder: this.requestConfigBuilder,
    };
  }

  codeSystemValidationContext(): CodeSystemValidationOperationContext {
    return {
      config: this.config,
      circuitBreakers: this.circuitBreakers,
      operationCache: this.operationCache,
      pendingRequests: this.pendingCodeSystemValidateCodeRequests,
      remoteBudget: this.remoteCodeSystemBudget,
      requestBroker: this.requestBroker,
      requestConfigBuilder: this.requestConfigBuilder,
    };
  }

  subsumptionContext(): TerminologySubsumptionOperationContext {
    return {
      circuitBreakers: this.circuitBreakers,
      getConfig: () => this.config,
      operationCache: this.operationCache,
      pendingRequests: this.pendingSubsumesRequests,
      requestBroker: this.requestBroker,
      requestConfigBuilder: this.requestConfigBuilder,
    };
  }
}
