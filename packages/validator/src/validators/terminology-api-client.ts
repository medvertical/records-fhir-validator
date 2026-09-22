import { markValidationDependencyUnattested } from '../validation-dependency-snapshot.js';
/**
 * HTTP client facade for terminology server operations.
 */

import { TerminologyApiClientRuntime } from './terminology-api-client-runtime.js';
import type {
  CodeSystemValidationResult,
  RemoteValueSetValidationOutcome,
  RemoteValueSetValidationResult,
  SubsumptionOutcome,
} from './terminology-api-types.js';
import type { TerminologyCircuitBreakerRegistry } from './terminology-circuit-breakers.js';
import { validateCodeSystemRemotely } from './terminology-code-system-validation-operation.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { TerminologyRequestBroker } from './terminology-request-broker.js';
import { executeRemoteSubsumption } from './terminology-subsumption-operation.js';
import {
  executeRemoteValueSetExpansion,
  isRemoteValueSetNotResolvable,
  validateCodeAgainstRemoteValueSet,
} from './terminology-valueset-operations.js';
import type { ValueSetCache } from './valueset-cache.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';
import type {
  TerminologyResolutionConfig,
  TerminologyServerOverride,
} from './valueset-types.js';

export type {
  CodeSystemValidationIssue,
  CodeSystemValidationResult,
  SubsumptionOutcome,
} from './terminology-api-types.js';
export { isSnomedNationalExtensionCode } from './terminology-code-system-result.js';

export class TerminologyApiClient {
  private readonly runtime: TerminologyApiClientRuntime;

  constructor(
    config: TerminologyResolutionConfig,
    cache?: ValueSetCache,
    operationCache?: TerminologyOperationCache,
    circuitBreakers?: TerminologyCircuitBreakerRegistry,
    requestBroker?: TerminologyRequestBroker,
  ) {
    this.runtime = new TerminologyApiClientRuntime(
      config,
      cache,
      operationCache,
      circuitBreakers,
      requestBroker,
    );
  }

  setConfig(config: TerminologyResolutionConfig): void {
    this.runtime.setConfig(config);
  }

  async expandValueSet(
    valueSetUrl: string,
    override?: TerminologyServerOverride,
  ): Promise<Set<string> | null> {
    markValidationDependencyUnattested('Online terminology does not attest an immutable dataset for this comparison.');
    return executeRemoteValueSetExpansion(
      this.runtime.valueSetOperationsContext(),
      valueSetUrl,
      override,
    );
  }

  async validateCode(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example',
    override?: TerminologyServerOverride,
    codeSystemVersion?: string,
  ): Promise<boolean> {
    markValidationDependencyUnattested('Online terminology does not attest an immutable dataset for this comparison.');
    const result = await validateCodeAgainstRemoteValueSet(
      this.runtime.valueSetOperationsContext(),
      { code, system, valueSetUrl, bindingStrength, override, codeSystemVersion },
    );
    return result.accepted;
  }

  async validateCodeOutcome(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example',
    override?: TerminologyServerOverride,
    codeSystemVersion?: string,
    valueSet?: import('./valueset-types.js').ValueSet,
  ): Promise<RemoteValueSetValidationOutcome> {
    const result = await this.validateCodeAttempt(
      code, system, valueSetUrl, bindingStrength, override, codeSystemVersion, valueSet,
    );
    return result.outcome;
  }

  /** The outcome together with why the server left it undecided, for binding diagnostics. */
  async validateCodeAttempt(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example',
    override?: TerminologyServerOverride,
    codeSystemVersion?: string,
    valueSet?: import('./valueset-types.js').ValueSet,
  ): Promise<RemoteValueSetValidationResult> {
    markValidationDependencyUnattested('Online terminology does not attest an immutable dataset for this comparison.');
    return validateCodeAgainstRemoteValueSet(
      this.runtime.valueSetOperationsContext(),
      { code, system, valueSetUrl, bindingStrength, override, codeSystemVersion, valueSet },
    );
  }

  isValueSetNotResolvable(
    valueSetUrl: string,
    override?: TerminologyServerOverride,
    system?: string,
    codeSystemVersion?: string,
  ): boolean {
    return isRemoteValueSetNotResolvable(
      this.runtime.valueSetOperationsContext(),
      valueSetUrl,
      override,
      system,
      codeSystemVersion,
    );
  }

  async validateCodeInCodeSystem(
    code: string,
    system: string,
    display?: string,
    override?: TerminologyServerOverride,
    codeSystemVersion?: string,
  ): Promise<CodeSystemValidationResult> {
    markValidationDependencyUnattested('Online terminology does not attest an immutable dataset for this comparison.');
    if (!canDelegateCodeValidation(this.runtime.getConfig())) return { valid: true };
    return validateCodeSystemRemotely(
      this.runtime.codeSystemValidationContext(),
      code,
      system,
      display,
      override,
      codeSystemVersion,
    );
  }

  async subsumes(
    system: string,
    codeA: string,
    codeB: string,
    override?: TerminologyServerOverride,
  ): Promise<SubsumptionOutcome> {
    markValidationDependencyUnattested('Online terminology does not attest an immutable dataset for this comparison.');
    return executeRemoteSubsumption(
      this.runtime.subsumptionContext(),
      { codeA, codeB, system, override },
    );
  }

  async isSubsumedBy(
    system: string,
    child: string,
    parent: string,
    override?: TerminologyServerOverride,
  ): Promise<boolean> {
    const outcome = await this.subsumes(system, parent, child, override);
    return outcome === 'subsumes' || outcome === 'equivalent';
  }
}
