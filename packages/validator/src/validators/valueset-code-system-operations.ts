import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { CodeSystemValidationResult, TerminologyApiClient } from './terminology-api-client.js';
import type { SubsumptionOutcome } from './terminology-api-types.js';
import {
  type TerminologyResolutionConfig,
  type TerminologyServerOverride,
  type CodeBindingOutcome,
  isExternalCodeSystem,
} from './valueset-types.js';
import {
  hasTerminologyServer,
  isSnomedEditionRouteMissing,
  isTerminologyServerEligible,
  listFallbackTerminologyServers,
  resolveTerminologyServerForSystem,
} from './valueset-server-routing.js';
import type { TerminologyServerAttempt } from '../issues/unverified-binding-diagnostic.js';
import { validateCodeViaTerminologyServerWithFilters } from './valueset-terminology-server-validation.js';
import { validateCodeInCodeSystemWithFallbacks } from './valueset-code-system-validator.js';
import { buildUnverifiableCodeSystemResult } from './valueset-code-system-rules.js';
import { validateCodeInLocalCodeSystem } from './valueset-local-code-system-validation.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';

export class ValueSetCodeSystemOperations {
  constructor(private readonly dependencies: {
    apiClient: TerminologyApiClient;
    cache: ValueSetCache;
    getResolutionConfig: () => TerminologyResolutionConfig;
    packageLoader: ValueSetPackageLoader;
  }) {}

  isExternal(system: string, fhirVersion?: FhirVersion): boolean {
    return isExternalCodeSystem(system) || (this.dependencies.getResolutionConfig().servers ?? []).some(server =>
      isTerminologyServerEligible(server, fhirVersion) && server.preferredSystems?.includes(system));
  }

  resolveServer(
    system?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): TerminologyServerOverride | undefined {
    return resolveTerminologyServerForSystem(
      this.dependencies.getResolutionConfig(),
      system,
      codeSystemVersion,
      fhirVersion,
    );
  }

  hasServer(override?: { url: string }, fhirVersion?: FhirVersion): boolean {
    const config = this.dependencies.getResolutionConfig();
    return canDelegateCodeValidation(config)
      && hasTerminologyServer(config, override, fhirVersion);
  }

  async validateViaServer(options: {
    code: string;
    system?: string;
    valueSetUrl: string;
    bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example';
    override?: TerminologyServerOverride;
    fhirVersion?: FhirVersion;
    codeSystemVersion?: string;
    attempts?: TerminologyServerAttempt[];
  }): Promise<CodeBindingOutcome> {
    return validateCodeViaTerminologyServerWithFilters({
      apiClient: this.dependencies.apiClient,
      packageLoader: this.dependencies.packageLoader,
      hasTerminologyServer: candidate => this.hasServer(candidate, options.fhirVersion),
      code: options.code,
      system: options.system,
      valueSetUrl: options.valueSetUrl,
      bindingStrength: options.bindingStrength,
      override: options.override,
      fhirVersion: options.fhirVersion,
      codeSystemVersion: options.codeSystemVersion,
      attempts: options.attempts,
      fallbackServers: listFallbackTerminologyServers(
        this.dependencies.getResolutionConfig(),
        options.override,
        options.system,
        options.codeSystemVersion,
        options.fhirVersion,
      ),
    });
  }

  async validate(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): Promise<CodeSystemValidationResult> {
    const localResult = await this.validateLocal(
      code,
      system,
      display,
      fhirVersion,
      codeSystemVersion,
    );
    const resolutionConfig = this.dependencies.getResolutionConfig();
    if (localResult) {
      return buildUnverifiableCodeSystemResult(
        code, system, localResult, resolutionConfig, codeSystemVersion, fhirVersion,
      ) ?? localResult;
    }
    if (!this.isExternal(system, fhirVersion)) return { valid: true };
    if (!canDelegateCodeValidation(resolutionConfig)) return { valid: true };

    const primaryOverride = this.resolveServer(system, fhirVersion, codeSystemVersion);
    if (
      isSnomedEditionRouteMissing(system, codeSystemVersion, primaryOverride)
      || !this.hasServer(primaryOverride, fhirVersion)
    ) {
      return buildUnverifiableCodeSystemResult(
        code,
        system,
        { valid: false, reason: 'code-unknown' },
        resolutionConfig,
        codeSystemVersion,
        fhirVersion,
      ) ?? { valid: true };
    }

    const result = await validateCodeInCodeSystemWithFallbacks({
      apiClient: this.dependencies.apiClient,
      code,
      codeSystemVersion,
      display,
      fhirVersion,
      primaryOverride,
      resolutionConfig,
      system,
    });
    return buildUnverifiableCodeSystemResult(
      code, system, result, resolutionConfig, codeSystemVersion, fhirVersion,
    ) ?? result;
  }

  validateLocal(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return validateCodeInLocalCodeSystem(
      { cache: this.dependencies.cache, packageLoader: this.dependencies.packageLoader },
      code,
      system,
      display,
      fhirVersion,
      codeSystemVersion,
    );
  }

  async resolveSubsumption(system: string, codeA: string, codeB: string): Promise<SubsumptionOutcome> {
    const override = this.resolveServer(system);
    if (!this.hasServer(override)) return 'unknown';
    return this.dependencies.apiClient.subsumes(system, codeA, codeB, override);
  }
}
