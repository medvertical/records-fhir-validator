import type { Binding } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  unverifiedBindingKey,
  type TerminologyServerAttempt,
  type UnverifiedBindingDiagnostic,
} from '../issues/unverified-binding-diagnostic.js';
import type {
  CodeSystemValidationResult,
  TerminologyApiClient,
} from './terminology-api-client.js';
import type { SubsumptionOutcome } from './terminology-api-types.js';
import type { BindingStrength } from './valueset-display-utils.js';
import { expandValueSet } from './valueset-expansion-loader.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { validateValueSetMembership } from './valueset-membership-validator.js';
import { preloadCommonValueSets } from './valueset-cache-operations.js';
import {
  validateBinding as validateBindingFlow,
  type BindingValidationDeps,
  type ValidateBindingOptions,
} from './valueset-binding-validator.js';
import { resolveCodeBindingSafely as runSafeBindingResolution } from './valueset-binding-resolution-safety.js';
import { resolveValueSetCodeBinding, resolveBindingCodeSystemVersion } from './valueset-code-binding-resolver.js';
import { resolveCodeSystemVersion } from './terminology-config-snapshot.js';
import type { ValueSetCodeSystemOperations } from './valueset-code-system-operations.js';
import { isValueSetAvailable as resolveValueSetAvailability } from './valueset-availability.js';
import type {
  CodeBindingOutcome,
  TerminologyServerOverride,
} from './valueset-types.js';
import type { ValueSetValidatorRuntime } from './valueset-validator-runtime.js';

type ResolveCodeBinding = (
  code: string,
  system: string | undefined,
  valueSetUrl: string,
  bindingStrength: BindingStrength,
  fhirVersion?: FhirVersion,
  elementPath?: string,
  codeSystemVersion?: string,
) => Promise<CodeBindingOutcome>;

/** Executes ValueSet validation use cases against one mutable runtime. */
export class ValueSetValidationPipeline {
  constructor(
    private readonly runtime: ValueSetValidatorRuntime,
    private readonly getApiClient: () => TerminologyApiClient,
    private readonly getCodeSystems: () => ValueSetCodeSystemOperations,
    private readonly resolveCodeBindingSeam: ResolveCodeBinding,
  ) {}

  async prewarmValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<void> {
    await this.runtime.packageLoader.loadValueSet(valueSetUrl, fhirVersion);
  }

  isExternalCodeSystem(system: string): boolean {
    return this.getCodeSystems().isExternal(system);
  }

  async validateBinding(
    code: unknown,
    binding: Binding | undefined,
    elementPath: string,
    options?: ValidateBindingOptions,
  ): Promise<ValidationIssue[]> {
    return validateBindingFlow(this.bindingValidationDeps(), code, binding, elementPath, options);
  }

  async isValueSetAvailable(
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return resolveValueSetAvailability({
      getExpandedValueSet: this.getExpandedValueSet.bind(this),
      packageLoader: this.runtime.packageLoader,
    }, valueSetUrl, fhirVersion);
  }

  async isCodeValidForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return (await this.resolveCodeBindingForBinding(
      code, system, valueSetUrl, bindingStrength, fhirVersion,
    )) !== 'invalid';
  }

  async resolveCodeBindingForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
    elementPath?: string,
    codeSystemVersion?: string,
  ): Promise<CodeBindingOutcome> {
    const configuredVersion = resolveCodeSystemVersion(this.runtime.resolutionConfig, system, codeSystemVersion);
    const selectedVersion = codeSystemVersion === undefined && configuredVersion !== undefined
      ? await resolveBindingCodeSystemVersion(this.runtime.resolutionConfig,
        this.runtime.packageLoader, system, valueSetUrl, fhirVersion, codeSystemVersion)
      : codeSystemVersion;
    const outcome = await this.runtime.bindingResolutions.run([
      this.runtime.cache.contextKey(''),
      fhirVersion ?? '',
      bindingStrength,
      valueSetUrl,
      system ?? '',
      code,
      selectedVersion ?? '',
      elementPath ?? '',
    ], () => this.resolveCodeBindingSafely(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      fhirVersion,
      elementPath,
      selectedVersion,
    ));
    if (outcome === 'unverified' && selectedVersion !== codeSystemVersion) {
      const key = (version?: string) => this.runtime.cache.contextKey(unverifiedBindingKey(code, system, valueSetUrl, fhirVersion, version));
      const diagnostic = this.runtime.unverifiedBindingDiagnostics.get(key(selectedVersion));
      // Publication reads the caller's original request, paired with this same completed resolution.
      if (diagnostic) this.runtime.unverifiedBindingDiagnostics.set(key(codeSystemVersion), diagnostic);
    }
    return outcome;
  }

  async validateCodeInCodeSystem(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult> {
    return this.getCodeSystems().validate(
      code,
      system,
      display,
      fhirVersion,
      codeSystemVersion,
      displayLanguage,
    );
  }

  async validateCodeInLocalCodeSystemOnly(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return this.validateCodeInLocalCodeSystemWithLanguage(code, system, display, fhirVersion, codeSystemVersion);
  }

  async validateCodeInLocalCodeSystemWithLanguage(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return this.getCodeSystems().validateLocal(code, system, display, fhirVersion, codeSystemVersion, displayLanguage);
  }

  async isCodeInValueSet(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return validateValueSetMembership(
      {
        apiClient: this.getApiClient(),
        getExpandedValueSet: this.getExpandedValueSet.bind(this),
        packageLoader: this.runtime.packageLoader,
        resolutionConfig: this.runtime.resolutionConfig,
        terminologyDiagnostics: this.runtime.terminologyDiagnostics,
        twoPhaseShadow: this.runtime.twoPhaseShadow,
      },
      code,
      system,
      valueSetUrl,
      fhirVersion,
    );
  }

  async resolveCodeMembership(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion: FhirVersion,
  ): Promise<CodeBindingOutcome> {
    return this.resolveCodeBindingForBinding(code, system, valueSetUrl, 'required', fhirVersion);
  }

  async resolveSubsumption(
    system: string,
    codeA: string,
    codeB: string,
  ): Promise<SubsumptionOutcome> {
    return this.getCodeSystems().resolveSubsumption(system, codeA, codeB);
  }

  async preloadCommonValueSets(): Promise<void> {
    await preloadCommonValueSets(this.getExpandedValueSet.bind(this));
  }

  private bindingValidationDeps(): BindingValidationDeps {
    return {
      resolutionConfig: this.runtime.resolutionConfig,
      cache: this.runtime.cache,
      packageLoader: this.runtime.packageLoader,
      resolveCodeBindingForBinding: this.resolveCodeBindingForBinding.bind(this),
      isValueSetAvailable: this.isValueSetAvailable.bind(this),
      getUnverifiedBindingDiagnostic: (code, system, valueSetUrl, fhirVersion, codeSystemVersion) =>
        this.runtime.unverifiedBindingDiagnostics.get(
          this.runtime.cache.contextKey(unverifiedBindingKey(code, system, valueSetUrl, fhirVersion, codeSystemVersion)),
        ),
    };
  }

  private resolveServerForSystem(
    system?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): TerminologyServerOverride | undefined {
    return this.getCodeSystems().resolveServer(system, fhirVersion, codeSystemVersion);
  }

  private hasTerminologyServer(
    override?: { url: string },
    fhirVersion?: FhirVersion,
  ): boolean {
    return this.getCodeSystems().hasServer(override, fhirVersion);
  }

  private async validateCodeViaTerminologyServer(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: 'required' | 'extensible' | 'preferred' | 'example' | undefined,
    override: TerminologyServerOverride | undefined,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    attempts?: TerminologyServerAttempt[],
  ): Promise<CodeBindingOutcome> {
    return this.getCodeSystems().validateViaServer({
      code,
      system,
      valueSetUrl,
      bindingStrength,
      override,
      fhirVersion,
      codeSystemVersion,
      attempts,
    });
  }

  private rememberUnverifiedBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion: FhirVersion | undefined,
    codeSystemVersion: string | undefined,
    diagnostic: UnverifiedBindingDiagnostic,
  ): void {
    this.runtime.unverifiedBindingDiagnostics.set(
      this.runtime.cache.contextKey(unverifiedBindingKey(code, system, valueSetUrl, fhirVersion, codeSystemVersion)),
      diagnostic,
    );
  }

  private async resolveCodeBindingSafely(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
    elementPath?: string,
    codeSystemVersion?: string,
  ): Promise<CodeBindingOutcome> {
    return runSafeBindingResolution(
      () => this.resolveCodeBindingSeam(
        code,
        system,
        valueSetUrl,
        bindingStrength,
        fhirVersion,
        elementPath,
        codeSystemVersion,
      ),
      this.runtime.terminologyDiagnostics,
      () => this.rememberUnverifiedBinding(code, system, valueSetUrl, fhirVersion, codeSystemVersion, {
        cause: 'validation-error',
        localExpansion: 'none',
        serverAttempts: [],
        packageScope: this.runtime.packageLoader.hasHostPackageScope() ? 'tenant' : 'none',
      }),
    );
  }

  async resolveCodeBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
    elementPath?: string,
    codeSystemVersion?: string,
  ): Promise<CodeBindingOutcome> {
    return resolveValueSetCodeBinding({
      getExpandedValueSet: this.getExpandedValueSet.bind(this),
      hasTerminologyServer: this.hasTerminologyServer.bind(this),
      packageLoader: this.runtime.packageLoader,
      resolutionConfig: this.runtime.resolutionConfig,
      validateLocalCodeSystem: (code, system, family, version) => this.getCodeSystems().validateLocal(code, system, undefined, family, version),
      resolveServerForSystem: this.resolveServerForSystem.bind(this),
      terminologyDiagnostics: this.runtime.terminologyDiagnostics,
      twoPhaseShadow: this.runtime.twoPhaseShadow,
      recordUnverifiedBinding: diagnostic => this.rememberUnverifiedBinding(
        code, system, valueSetUrl, fhirVersion, codeSystemVersion, diagnostic,
      ),
      validateViaServer: this.validateCodeViaTerminologyServer.bind(this),
    }, code, system, valueSetUrl, bindingStrength, fhirVersion, elementPath, codeSystemVersion);
  }

  private getExpandedValueSet(
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<Set<string>> {
    return expandValueSet(
      {
        cache: this.runtime.cache,
        apiClient: this.getApiClient(),
        packageLoader: this.runtime.packageLoader,
        resolutionConfig: this.runtime.resolutionConfig,
      },
      valueSetUrl,
      fhirVersion,
    );
  }
}
