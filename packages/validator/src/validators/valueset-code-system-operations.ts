import { resolveCodeSystemVersion, snapshotTerminologyConfig } from './terminology-config-snapshot.js';
import { isImportedNamedCodeRejection } from './imported-terminology-inventory.js';
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
    const config = this.dependencies.getResolutionConfig();
    return resolveTerminologyServerForSystem(
      config, system, codeSystemVersion, fhirVersion,
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
    const config = this.dependencies.getResolutionConfig();
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
        config,
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
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult> {
    const resolutionConfig = snapshotTerminologyConfig(this.dependencies.getResolutionConfig());
    const selectedVersion = resolveCodeSystemVersion(resolutionConfig, system, codeSystemVersion);
    const localResult = await this.validateLocal(
      code,
      system,
      display,
      fhirVersion,
      selectedVersion,
      displayLanguage,
    );
    if (localResult) {
      if (isImportedNamedCodeRejection(localResult, code, system, fhirVersion, selectedVersion)) return localResult;
      return buildUnverifiableCodeSystemResult(
        code, system, localResult, resolutionConfig, selectedVersion, fhirVersion,
      ) ?? localResult;
    }
    if (!isExternalCodeSystem(system) && !(resolutionConfig.servers ?? []).some(server =>
      isTerminologyServerEligible(server, fhirVersion) && server.preferredSystems?.includes(system))) return { valid: true };
    if (!canDelegateCodeValidation(resolutionConfig)) return {
      valid: true,
      reason: 'delegation-disabled',
      message: 'CodeSystem membership was not verified because terminology code validation delegation is disabled.',
    };

    const primaryOverride = resolveTerminologyServerForSystem(resolutionConfig, system, selectedVersion, fhirVersion);
    if (
      isSnomedEditionRouteMissing(system, selectedVersion, primaryOverride)
      || !hasTerminologyServer(resolutionConfig, primaryOverride, fhirVersion)
    ) {
      return buildUnverifiableCodeSystemResult(
        code,
        system,
        { valid: false, reason: 'code-unknown' },
        resolutionConfig,
        selectedVersion,
        fhirVersion,
      ) ?? {
        valid: true,
        reason: 'no-server',
        message: 'CodeSystem membership was not verified because no enabled terminology server is available for this FHIR release.',
      };
    }

    const result = await validateCodeInCodeSystemWithFallbacks({
      apiClient: this.dependencies.apiClient,
      code,
      codeSystemVersion: selectedVersion,
      display,
      displayLanguage,
      fhirVersion,
      primaryOverride,
      resolutionConfig,
      system,
    });
    return buildUnverifiableCodeSystemResult(
      code, system, result, resolutionConfig, selectedVersion, fhirVersion,
    ) ?? result;
  }

  validateLocal(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return validateCodeInLocalCodeSystem(
      { cache: this.dependencies.cache, packageLoader: this.dependencies.packageLoader },
      code,
      system,
      display,
      fhirVersion,
      resolveCodeSystemVersion(this.dependencies.getResolutionConfig(), system, codeSystemVersion),
      displayLanguage,
    );
  }

  async resolveSubsumption(system: string, codeA: string, codeB: string): Promise<SubsumptionOutcome> {
    // The transport has no version parameter, so it cannot answer for an explicit default edition.
    if (resolveCodeSystemVersion(this.dependencies.getResolutionConfig(), system) !== undefined) return 'unknown';
    const override = this.resolveServer(system);
    if (!this.hasServer(override)) return 'unknown';
    return this.dependencies.apiClient.subsumes(system, codeA, codeB, override);
  }
}
