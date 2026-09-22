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
import { validateRecordsResource } from './validator-single-resource-validation.js';
import type { RecordsSingleResourceValidationInput } from './validator-single-resource-pipeline.js';
import { checkRecordsValidatorAvailability } from './validator-initialization.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import {
  validateContainedResourceTree,
} from './validator-contained-issues.js';
import { validateParametersResourceTree } from './parameters-resource-validation.js';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { isFhirResource, type FhirResource } from './fhir-resource.js';
import type { MultiAspectValidateResult } from './multi-aspect-types.js';
import { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';
import { validateRecordsBundleEntries } from './validator-bundle-entry-runtime.js';
import { ValidatorRuntimeControls } from './validator-runtime-controls.js';

export type { RecordsValidatorConfig } from './validator-engine-config.js';

export interface ValidationContext {
  resource: unknown;
  resourceType: string;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  strictMode: boolean;
}

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
  ): Promise<
    Map<unknown, ValidationIssue[]> |
    Map<unknown, MultiAspectValidateResult>
  > {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(options.settings as ValidationSettings | undefined);

    return validateRecordsBatch(resources, options, this.createBatchValidationContext());
  }

  async validateAspects(
    resource: unknown,
    options: BatchValidationOptions,
  ): Promise<MultiAspectValidateResult> {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(options.settings as ValidationSettings | undefined);
    return validateRecordsAspects(
      resource,
      options,
      this.createBatchValidationContext(),
    );
  }

  private createBatchValidationContext(): RecordsBatchValidationContext {
    return createRecordsBatchValidationContext({
      components: this.components,
      profileWarmupCoordinator: this.profileWarmupCoordinator,
      strictMode: this.config.strictMode || false,
      validateSingleResource: (target, profileUrl, version, settings, client, orgId, serverId) =>
        this.validate(target, profileUrl, version, settings, client, undefined, orgId, serverId),
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
  ): Promise<ValidationIssue[]> {
    return this.validateWithInput(
      { resource, profileUrl, fhirVersion, settings, fhirClient, referenceResolver, organizationId, serverId },
      recursionDepth,
    );
  }

  private async validateWithInput(
    input: RecordsSingleResourceValidationInput,
    recursionDepth: number,
  ): Promise<ValidationIssue[]> {
    await this.waitForInitialization();
    this.runtimeControls.applySettings(input.settings);

    const validateEmbeddedResource = (embedded: FhirResourceRecord, embeddedProfile: string, nextDepth: number) =>
      this.validateWithInput({ ...input, resource: embedded, profileUrl: embeddedProfile }, nextDepth);

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
      validateBundleEntriesIfNeeded: (target, version) =>
        this.validateBundleEntriesIfNeeded(target, version),
      validateContainedResourcesIfNeeded: (target) =>
        validateContainedResourceTree(target, {
          recursionDepth,
          maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
          validate: validateEmbeddedResource,
        }),
      validateParametersResourcesIfNeeded: (target) =>
        validateParametersResourceTree(target, {
          recursionDepth,
          maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
          validate: validateEmbeddedResource,
        }),
      validateAgainstProfile: (target, mandatedProfile) =>
        validateEmbeddedResource(target, mandatedProfile, recursionDepth + 1),
    });
  }

  private async validateBundleEntriesIfNeeded(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]> {
    if (!isFhirResource(resource) || resource.resourceType !== 'Bundle' || !Array.isArray(resource.entry)) {
      return [];
    }
    return this.validateBundleEntries(resource, fhirVersion, 1);
  }

  private static readonly BUNDLE_ENTRY_MAX_DEPTH = 3;

  async validateStructure(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    recursionDepth: number = 0
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    return validateResourceStructure(resource, fhirVersion, recursionDepth, {
      sdLoader: this.components.sdLoader,
      profileCache: this.components.profileCache,
      snapshotGenerator: this.components.snapshotGenerator,
      structuralExecutor: this.components.structuralExecutor,
      questionnaireRegistry: this.components.questionnaireRegistry,
      maxBundleEntryDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      validateBundleEntries: (bundle, version, nextDepth) =>
        this.validateBundleEntries(bundle, version, nextDepth),
    });
  }

  private async validateBundleEntries(
    bundle: FhirResource,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
  ): Promise<ValidationIssue[]> {
    return validateRecordsBundleEntries(bundle, fhirVersion, recursionDepth, {
      sdLoader: this.components.sdLoader,
      profileCache: this.components.profileCache,
      snapshotGenerator: this.components.snapshotGenerator,
      maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      structuralExecutor: this.components.structuralExecutor,
      validateResource: (resource, profileUrl, version, referenceResolver, bundleCanonicalResolver) =>
        this.validateWithInput(
          { resource, profileUrl, fhirVersion: version, referenceResolver, bundleCanonicalResolver },
          0,
        ),
    });
  }

  async validateMetadata(
    resource: unknown
  ): Promise<ValidationIssue[]> {
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

  async prewarmQuestionnaireAnswerValueSets(questionnaire: unknown): Promise<void> {
    await this.runtimeControls.prewarmQuestionnaireAnswerValueSets(questionnaire);
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
