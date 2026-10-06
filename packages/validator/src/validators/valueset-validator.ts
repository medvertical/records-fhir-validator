import { bindingPinSource, withPinnedCanonicalSource, type PinnedBinding } from '../package/canonical-pin-scope.js';
import type { Binding, StructureDefinition } from '../core/structure-definition-types.js';
import { pinBindingToDependencyPins } from '../core/executors/terminology-binding-dependency-pins.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { CodeSystemValidationResult } from './terminology-api-client.js';
import type { SubsumptionOutcome } from './terminology-api-types.js';
import { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { ValidateBindingOptions } from './valueset-binding-validator.js';
import { ValueSetCache } from './valueset-cache.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { BindingStrength } from './valueset-display-utils.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import {
  EXTERNAL_CODE_SYSTEMS,
  type CodeBindingOutcome,
  type TerminologyResolutionConfig,
} from './valueset-types.js';
import { ValueSetValidationPipeline } from './valueset-validation-pipeline.js';
import { ValueSetValidatorRuntime } from './valueset-validator-runtime.js';

export type {
  CodeSystem,
  TerminologyResolutionConfig,
  TerminologyResolutionStrategy,
  ValueSet,
} from './valueset-types.js';

export interface TerminologyDefinitionLookup {
  readonly cache: ValueSetCache;
  readonly packageLoader: Pick<ValueSetPackageLoader, 'loadCodeSystem' | 'loadCodeSystemOutcome' | 'loadValueSetResource' | 'getPackageDirectories'>;
}

export class ValueSetValidator {
  private readonly runtime: ValueSetValidatorRuntime;
  private readonly pipeline: ValueSetValidationPipeline;

  static readonly EXTERNAL_CODE_SYSTEMS = EXTERNAL_CODE_SYSTEMS;

  constructor(
    cache: ValueSetCache = new ValueSetCache(),
    operationCache: TerminologyOperationCache = new TerminologyOperationCache(),
    packageDirectories?: string[],
  ) {
    this.runtime = new ValueSetValidatorRuntime(cache, operationCache, packageDirectories);
    this.pipeline = new ValueSetValidationPipeline(
      this.runtime,
      () => this.apiClient,
      () => this.codeSystems,
      (...args) => this.resolveCodeBinding(...args),
    );
  }

  /** Retained as a private test seam for terminology transport regressions. */
  private get apiClient() { return this.runtime.apiClient; }

  /** Retained as a private test seam for local CodeSystem regressions. */
  private get codeSystems() { return this.runtime.codeSystems; }

  setResolutionConfig(config: Partial<TerminologyResolutionConfig>): void {
    this.runtime.setResolutionConfig(config);
  }

  getResolutionConfig(): TerminologyResolutionConfig {
    return this.runtime.getResolutionConfig();
  }

  /** Bind package lookups to the host tenant scope before validation work starts. */
  setSourceContext(context: ProfileSourceContext | undefined): void {
    this.runtime.setSourceContext(context);
  }

  withSourceContext<T>(context: ProfileSourceContext | undefined, run: () => T): T {
    return this.runtime.cache.sourceContexts.runWith(context, run);
  }

  /** Reference and membership lookups must share this instance's stores and request scope. */
  getDefinitionLookup(): TerminologyDefinitionLookup {
    return { cache: this.runtime.cache, packageLoader: this.runtime.packageLoader };
  }

  getOperationCache(): TerminologyOperationCache {
    return this.runtime.operationCache;
  }

  registerExternalTerminologyResource(
    resource: unknown,
    fhirVersion: FhirVersion = 'R4',
  ): boolean {
    return this.runtime.registerExternalTerminologyResource(resource, fhirVersion);
  }

  async prewarmValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<void> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    await this.pipeline.prewarmValueSet(valueSetUrl, fhirVersion);
      });
  }

  isExternalCodeSystem(system: string): boolean {
    return this.pipeline.isExternalCodeSystem(system);
  }

  async validateBinding(
    code: unknown,
    binding: (Binding & PinnedBinding) | undefined,
    elementPath: string,
    options?: ValidateBindingOptions,
  ): Promise<ValidationIssue[]> {
    return this.runtime.cache.sourceContexts.run(options?.fhirVersion, async () => {
    return withPinnedCanonicalSource(binding?.[bindingPinSource],
      () => this.pipeline.validateBinding(code, binding, elementPath, options));
      });
  }

  /** Binding selection and membership must consult the same instance's package stores. */
  async pinBindingToProfile<T extends Binding | undefined>(
    binding: T, profile: Pick<StructureDefinition, 'url' | 'version'>, fhirVersion?: FhirVersion,
  ): Promise<T> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return pinBindingToDependencyPins(binding, profile, fhirVersion, this.runtime.packageLoader.getPackageDirectories());
      });
  }

  async isValueSetAvailable(
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.isValueSetAvailable(valueSetUrl, fhirVersion);
      });
  }

  async isCodeValidForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.isCodeValidForBinding(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      fhirVersion,
    );
      });
  }

  /** Tri-state binding validation that distinguishes unverified from invalid. */
  async resolveCodeBindingForBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
    elementPath?: string,
    codeSystemVersion?: string,
  ): Promise<CodeBindingOutcome> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.resolveCodeBindingForBinding(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      fhirVersion,
      elementPath,
      codeSystemVersion,
    );
      });
  }

  async validateCodeInCodeSystem(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.validateCodeInCodeSystem(
      code,
      system,
      display,
      fhirVersion,
      codeSystemVersion,
      displayLanguage,
    );
      });
  }

  async validateCodeInLocalCodeSystemOnly(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.validateCodeInLocalCodeSystemOnly(
      code,
      system,
      display,
      fhirVersion,
      codeSystemVersion,
    );
      });
  }

  async validateCodeInLocalCodeSystemWithLanguage(
    code: string,
    system: string,
    display?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    displayLanguage?: string,
  ): Promise<CodeSystemValidationResult | null> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, () =>
      this.pipeline.validateCodeInLocalCodeSystemWithLanguage(code, system, display, fhirVersion, codeSystemVersion, displayLanguage));
  }

  async isCodeInValueSet(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ): Promise<boolean> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.isCodeInValueSet(code, system, valueSetUrl, fhirVersion);
      });
  }

  async resolveCodeMembership(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion: FhirVersion,
  ): Promise<CodeBindingOutcome> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.resolveCodeMembership(code, system, valueSetUrl, fhirVersion);
      });
  }

  async resolveSubsumption(
    system: string,
    codeA: string,
    codeB: string,
  ): Promise<SubsumptionOutcome> {
    return this.runtime.cache.sourceContexts.run(undefined, async () => {
    return this.pipeline.resolveSubsumption(system, codeA, codeB);
      });
  }

  clearCache(): void {
    this.runtime.clearCache();
  }

  getCacheStats() {
    return this.runtime.getCacheStats();
  }

  async preloadCommonValueSets(): Promise<void> {
    return this.runtime.cache.sourceContexts.run(undefined, async () => {
    await this.pipeline.preloadCommonValueSets();
      });
  }

  /** Retained as a private test seam for binding singleflight and failure regressions. */
  private async resolveCodeBinding(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    fhirVersion?: FhirVersion,
    elementPath?: string,
    codeSystemVersion?: string,
  ): Promise<CodeBindingOutcome> {
    return this.runtime.cache.sourceContexts.run(fhirVersion, async () => {
    return this.pipeline.resolveCodeBinding(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      fhirVersion,
      elementPath,
      codeSystemVersion,
    );
      });
  }
}
