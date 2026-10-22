import { withBatchProfileMetadataCache, withProfileReferenceBatchSnapshot, withProfileReferenceInventorySnapshot } from '../validation-dependency-snapshot.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';

import type { TerminologyResolutionConfig } from '../validators/valueset-validator.js';
import type { FhirClientLike } from './profile-loader-utils.js';
import type { BatchValidationOptions } from './batch-validator.js';
import type { AnomalyFinding, AnomalyDetectorConfig } from '../validators/anomaly-detector.js';
import { resolveRecordsValidatorConfig, type RecordsValidatorConfig } from './validator-engine-config.js';
import {
  createRecordsValidatorComponents,
  type RecordsValidatorComponents,
} from './validator-engine-components.js';
import { validateResourceStructure } from './validator-structure-validation.js';
import {
  validateRecordsAspects,
  validateRecordsBatch,
  createRecordsBatchValidationContext,
  type RecordsBatchValidationContext,
} from './validator-batch-validation.js';
import { createSingleResourceRecursiveValidation, validateRecordsResource } from './validator-single-resource-validation.js';
import type { RecordsSingleResourceValidationInput } from './validator-single-resource-pipeline.js';
import { createSingleResourceConformanceSession, type SingleResourceConformanceFactory } from './single-resource-profile-conformance.js';
import { checkRecordsValidatorAvailability } from './validator-initialization.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { isFhirResource, type FhirResource } from './fhir-resource.js';
import type { MultiAspectValidateResult } from './multi-aspect-types.js';
import { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';
import { validateRecordsBundleEntries } from './validator-bundle-entry-runtime.js';
import { ValidatorRuntimeControls } from './validator-runtime-controls.js';
import type { CustomRuleSelectedRelease } from '../custom-rules/applicability.js';
import { resolveTerminologySourceContext } from './validator-terminology-snapshot-context.js';
import { withSnapshotProfileChecks } from './snapshot-profile-checks.js';

export type { RecordsValidatorConfig, ValidationContext } from './validator-engine-config.js';


export class RecordsValidator {
  private config: RecordsValidatorConfig;
  private readonly components: RecordsValidatorComponents;
  private available: boolean = false;
  private initializationPromise: Promise<void>;
  private readonly profileWarmupCoordinator = new ProfileWarmupCoordinator();
  private readonly runtimeControls: ValidatorRuntimeControls;

  constructor(config: RecordsValidatorConfig = {}) {
    this.config = resolveRecordsValidatorConfig(config);

    this.components = createRecordsValidatorComponents(this.config);
    this.runtimeControls = new ValidatorRuntimeControls(
      this.components,
      this.profileWarmupCoordinator,
    );

    this.initializationPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    this.available = await checkRecordsValidatorAvailability(this.components.sdLoader);
  }

  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async validateBatch(
    resources: unknown[],
    options: BatchValidationOptions = {}
  ): Promise<Map<unknown, ValidationIssue[]> | Map<unknown, MultiAspectValidateResult>> {
    const validationOptions = { ...options, selectedRelease: options.selectedRelease === undefined ? options.fhirVersion ?? 'R4' : options.selectedRelease };
    const terminologyContext = await resolveTerminologySourceContext(options);
    return withSnapshotProfileChecks(terminologyContext, () => this.components.valuesetValidator.withSourceContext(terminologyContext, async () => {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(validationOptions.settings as ValidationSettings | undefined);

    const run = () => validateRecordsBatch(resources, validationOptions, this.createBatchValidationContext());
    // A bounded capture may need a fresh run. Keep callback-bearing batches on
    // per-resource captures while sharing only bounded package metadata.
    return options.onResourceValidated || options.onEmbeddedResourceValidated || options.scheduleValidation
      ? withBatchProfileMetadataCache(run) : withProfileReferenceBatchSnapshot(run);
    }), resources);
  }

  async validateAspects(
    resource: unknown,
    options: BatchValidationOptions,
  ): Promise<MultiAspectValidateResult> {
    const validationOptions = { ...options, selectedRelease: options.selectedRelease === undefined ? options.fhirVersion ?? 'R4' : options.selectedRelease };
    const terminologyContext = await resolveTerminologySourceContext(options);
    return withSnapshotProfileChecks(terminologyContext, () => this.components.valuesetValidator.withSourceContext(terminologyContext, async () => {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(validationOptions.settings as ValidationSettings | undefined);
    return validateRecordsAspects(
      resource,
      validationOptions,
      this.createBatchValidationContext(),
    );
    }), [resource]);
  }

  private createBatchValidationContext(): RecordsBatchValidationContext {
    return createRecordsBatchValidationContext({
      components: this.components,
      profileWarmupCoordinator: this.profileWarmupCoordinator,
      strictMode: this.config.strictMode || false,
      validateSingleResource: (target, profileUrl, version, settings, client, orgId, serverId, selectedRelease) =>
        this.validate(target, profileUrl, version, settings, client, undefined, orgId, serverId, 0, selectedRelease),
    });
  }

  async validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
    referenceResolver?: ReferenceResolver | null,
    organizationId?: number,
    serverId?: number,
    recursionDepth: number = 0,
    selectedRelease: CustomRuleSelectedRelease | null = fhirVersion,
  ): Promise<ValidationIssue[]> {
    const terminologyContext = await resolveTerminologySourceContext({ organizationId, serverId, fhirVersion, settings });
    return withSnapshotProfileChecks(terminologyContext, () => withProfileReferenceInventorySnapshot(() => this.components.valuesetValidator.withSourceContext(terminologyContext, async () => {
    return this.validateWithInput(
      { resource, profileUrl, fhirVersion, selectedRelease, settings, fhirClient, referenceResolver, organizationId, serverId },
      recursionDepth,
    );
    })), [resource]);
  }

  private async validateWithInput(
    input: RecordsSingleResourceValidationInput,
    recursionDepth: number,
    options: { skipEmbeddedValidation?: boolean; skipBundleEntries?: boolean } = {},
    conformanceSession?: SingleResourceConformanceFactory,
  ): Promise<ValidationIssue[]> {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(input.settings);

    const conformance = conformanceSession ?? createSingleResourceConformanceSession(
      { ...this.components, fhirClient: input.fhirClient, strictMode: this.config.strictMode || false }, input,
    );

    return validateRecordsResource(input, {
      sdLoader: this.components.sdLoader,
      profileCache: this.components.profileCache,
      snapshotGenerator: this.components.snapshotGenerator,
      structuralExecutor: this.components.structuralExecutor,
      profileExecutor: this.components.profileExecutor,
      terminologyExecutor: this.components.terminologyExecutor,
      invariantExecutor: this.components.invariantExecutor,
      customRuleExecutor: this.components.customRuleExecutor,
      metadataExecutor: this.components.metadataExecutor,
      referenceExecutor: this.components.referenceExecutor,
      bestPracticeValidator: this.components.bestPracticeValidator,
      terminologyResourceValidator: this.components.terminologyResourceValidator,
      questionnaireRegistry: this.components.questionnaireRegistry,
      strictMode: this.config.strictMode || false,
      createProfileConformance: conformanceInput => conformance(conformanceInput, recursionDepth),
      validateBundleEntriesIfNeeded: (target, version) =>
        options.skipEmbeddedValidation || options.skipBundleEntries
          ? Promise.resolve([]) : this.validateBundleEntriesIfNeeded(target, version, recursionDepth, input, conformance),
      ...createSingleResourceRecursiveValidation(input, {
        recursionDepth, maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
        skipEmbeddedValidation: options.skipEmbeddedValidation,
        validate: (embeddedInput, nextDepth, skipEmbeddedValidation = false) =>
          this.validateWithInput(embeddedInput, nextDepth, { skipEmbeddedValidation }, conformance),
      }),
    });
  }

  private async validateBundleEntriesIfNeeded(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
    input: RecordsSingleResourceValidationInput,
    conformance?: SingleResourceConformanceFactory,
  ): Promise<ValidationIssue[]> {
    if (recursionDepth >= RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH || !isFhirResource(resource) || resource.resourceType !== 'Bundle' || !Array.isArray(resource.entry)) {
      return [];
    }
    return this.validateBundleEntries(resource, fhirVersion, recursionDepth, input, conformance);
  }

  private static readonly BUNDLE_ENTRY_MAX_DEPTH = 3;

  async validateStructure(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    recursionDepth: number = 0
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    return withProfileReferenceInventorySnapshot(() => validateResourceStructure(resource, fhirVersion, recursionDepth, {
      sdLoader: this.components.sdLoader,
      profileCache: this.components.profileCache,
      snapshotGenerator: this.components.snapshotGenerator,
      structuralExecutor: this.components.structuralExecutor,
      questionnaireRegistry: this.components.questionnaireRegistry,
      maxBundleEntryDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      validateBundleEntries: (bundle, version, nextDepth) =>
        this.validateBundleEntries(bundle, version, nextDepth),
    }));
  }

  private async validateBundleEntries(
    bundle: FhirResource,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
    input?: RecordsSingleResourceValidationInput,
    conformance?: SingleResourceConformanceFactory,
  ): Promise<ValidationIssue[]> {
    return validateRecordsBundleEntries(bundle, fhirVersion, recursionDepth, {
      sdLoader: this.components.sdLoader,
      profileCache: this.components.profileCache,
      snapshotGenerator: this.components.snapshotGenerator,
      maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      structuralExecutor: this.components.structuralExecutor,
      validateResource: (resource, profileUrl, version, referenceResolver, bundleCanonicalResolver, nextDepth, skipEmbeddedValidation) =>
        this.validateWithInput(
          { ...input, resource, profileUrl, fhirVersion: version, referenceResolver, bundleCanonicalResolver,
            enclosingBundle: bundle, containingResource: resource },
          nextDepth, { skipEmbeddedValidation, skipBundleEntries: true }, conformance,
        ),
    });
  }

  async validateMetadata(resource: unknown): Promise<ValidationIssue[]> {
    await this.waitForInitialization();
    return this.components.directAspectValidation.validateMetadata(resource);
  }

  async validateReferences(
    resource: unknown,
    fhirClient?: FhirClientLike,
    fhirVersion?: 'R4' | 'R5' | 'R6'
  ): Promise<ValidationIssue[]> {
    return this.components.directAspectValidation.validateReferences(resource, fhirClient, fhirVersion);
  }

  async isProfileSupported(
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<boolean> {
    await this.waitForInitialization();
    return this.runtimeControls.isProfileSupported(profileUrl, fhirVersion);
  }

  getSupportedProfiles(): string[] {
    return this.runtimeControls.getSupportedProfiles();
  }

  getSdLoader(): StructureDefinitionLoader {
    return this.runtimeControls.getSdLoader();
  }

  async loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ) {
    return this.runtimeControls.loadProfileWithSnapshot(profileUrl, fhirVersion);
  }

  registerQuestionnaire(questionnaire: unknown): boolean {
    return this.runtimeControls.registerQuestionnaire(questionnaire);
  }

  async prewarmQuestionnaireAnswerValueSets(
    questionnaire: unknown, fhirVersion?: 'R4' | 'R5' | 'R6',
  ): Promise<void> {
    await this.runtimeControls.prewarmQuestionnaireAnswerValueSets(questionnaire, fhirVersion);
  }

  getQuestionnaire(canonicalOrRef: string | undefined | null): FhirResourceRecord | null {
    return this.runtimeControls.getQuestionnaire(canonicalOrRef);
  }

  configureTerminologyResolution(config: TerminologyResolutionConfig): void {
    this.runtimeControls.configureTerminologyResolution(config);
  }

  clearTerminologyCache(): void {
    this.runtimeControls.clearTerminologyCache();
  }

  registerTerminologyResource(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): boolean {
    return this.runtimeControls.registerTerminologyResource(resource, fhirVersion);
  }

  getConstraintDiagnostics(): ReturnType<RecordsValidatorComponents['constraintValidator']['getDiagnostics']> {
    return this.runtimeControls.getConstraintDiagnostics();
  }

  clearConstraintDiagnostics(): void {
    this.runtimeControls.clearConstraintDiagnostics();
  }

  getFHIRPathCacheStats() {
    return this.runtimeControls.getFHIRPathCacheStats();
  }

  clearFHIRPathCaches(): void {
    this.runtimeControls.clearFHIRPathCaches();
  }

  clearProfileCache(): void {
    this.runtimeControls.clearProfileCache();
  }

  resetProfileWarmupState(): void {
    this.runtimeControls.resetProfileWarmupState();
  }

  evictProfile(profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): void {
    this.runtimeControls.evictProfile(profileUrl, fhirVersion);
  }

  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.runtimeControls.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.runtimeControls.getPinnedCanonicalCount();
  }

  getPinnedCanonicalFingerprint(): ReturnType<StructureDefinitionLoader['getPinnedCanonicalFingerprint']> {
    return this.runtimeControls.getPinnedCanonicalFingerprint();
  }

  detectAnomalies(
    resources: unknown[],
    config?: Partial<AnomalyDetectorConfig>,
  ): AnomalyFinding[] {
    return this.runtimeControls.detectAnomalies(resources, config);
  }
}
