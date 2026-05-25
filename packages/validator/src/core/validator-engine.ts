/**
 * Records Validator Engine
 *
 * Pure JavaScript/TypeScript FHIR Validation Engine
 * No Java dependency, optimized for speed and low memory usage
 *
 * Features:
 * - Profile validation against StructureDefinitions
 * - Structural validation (cardinality, types)
 * - Metadata validation
 * - FHIRPath constraint validation
 * - Extension and slicing support
 */

import type { ValidationIssue, ValidationSettings } from '../types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import type { StructureDefinition } from './structure-definition-types';

import { ValueSetValidator, type TerminologyResolutionConfig } from '../validators/valueset-validator';
import { logger } from '../logger';
import {
  StructuralExecutor,
  ProfileExecutor,
  TerminologyExecutor,
  ReferenceExecutor,
  InvariantExecutor,
  CustomRuleExecutor,
  MetadataExecutor
} from './executors';
import { createValidationErrorIssue } from './validation-utils';
import { loadProfileWithSnapshot, type FhirClientLike } from './profile-loader-utils';
import type { BatchValidationOptions } from './batch-validator';
import { AnomalyDetector, type AnomalyFinding, type AnomalyDetectorConfig } from '../validators/anomaly-detector';
import {
  applyProfileLoadingSettings,
  buildTerminologyResolutionConfig,
} from './validator-runtime-settings';
import { validateBundleEntryResources } from './validator-bundle-entry-validation';
import { QuestionnaireContextRegistry } from './questionnaire-context-registry';
import { resolveRecordsValidatorConfig, type RecordsValidatorConfig } from './validator-engine-config';
import {
  createRecordsValidatorComponents,
  type RecordsValidatorComponents,
} from './validator-engine-components';
import { validateResourceStructure } from './validator-structure-validation';
import { validateRecordsBatch } from './validator-batch-validation';
import { validateRecordsResource } from './validator-single-resource-validation';
import { checkRecordsValidatorAvailability } from './validator-initialization';

export type { RecordsValidatorConfig } from './validator-engine-config';

// ============================================================================
// Types
// ============================================================================

export interface ValidationContext {
  resource: any;
  resourceType: string;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  strictMode: boolean;
}

// ============================================================================
// Records Validator Engine
// ============================================================================

export class RecordsValidator {
  private config: RecordsValidatorConfig;
  private profileCache!: RecordsValidatorComponents['profileCache'];
  private sdLoader!: StructureDefinitionLoader;
  private valuesetValidator!: ValueSetValidator;
  private snapshotGenerator!: RecordsValidatorComponents['snapshotGenerator'];
  private available: boolean = false;
  private initializationPromise: Promise<void>;

  // Executors for per-aspect validation
  private structuralExecutor!: StructuralExecutor;
  private profileExecutor!: ProfileExecutor;
  private terminologyExecutor!: TerminologyExecutor;
  private referenceExecutor!: ReferenceExecutor;
  private invariantExecutor!: InvariantExecutor;
  private customRuleExecutor!: CustomRuleExecutor;
  private metadataExecutor!: MetadataExecutor;
  private bestPracticeValidator!: RecordsValidatorComponents['bestPracticeValidator'];
  private anomalyDetector!: AnomalyDetector;
  private questionnaireRegistry!: QuestionnaireContextRegistry;

  constructor(config: RecordsValidatorConfig = {}) {
    this.config = resolveRecordsValidatorConfig(config);

    const components = createRecordsValidatorComponents(this.config);
    Object.assign(this, components);

    // Start initialization (async, but store promise for waiting)
    this.initializationPromise = this.initialize();
  }

  /**
   * Initialize validator and check availability
   * This waits for profiles to be scanned before checking availability
   */
  private async initialize(): Promise<void> {
    this.available = await checkRecordsValidatorAvailability(this.sdLoader);
  }

  /**
   * Wait for initialization to complete
   * Call this before using the validator to ensure profiles are loaded
   */
  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  /**
   * Check if validator is available
   * Note: This returns the current state, but initialization may still be in progress
   * Use waitForInitialization() to ensure initialization is complete
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Validate multiple resources in batch (optimized)
   * This is 5-10x faster than calling validate() repeatedly
   * 
   * @param resources - Array of resources to validate
   * @param options - Batch validation options
   * @returns Map of resource to validation issues
   */
  async validateBatch(
    resources: any[],
    options: BatchValidationOptions = {}
  ): Promise<Map<any, ValidationIssue[]> | Map<any, any>> {
    await this.waitForInitialization();
    this.applyRuntimeSettings(options.settings as ValidationSettings | undefined);

    return validateRecordsBatch(resources, options, {
      sdLoader: this.sdLoader,
      profileCache: this.profileCache,
      snapshotGenerator: this.snapshotGenerator,
      structuralExecutor: this.structuralExecutor,
      profileExecutor: this.profileExecutor,
      terminologyExecutor: this.terminologyExecutor,
      referenceExecutor: this.referenceExecutor,
      invariantExecutor: this.invariantExecutor,
      customRuleExecutor: this.customRuleExecutor,
      metadataExecutor: this.metadataExecutor,
      bestPracticeValidator: this.bestPracticeValidator,
      strictMode: this.config.strictMode || false,
      validateSingleResource: (resource, profileUrl, fhirVersion, settings, fhirClient) =>
        this.validate(resource, profileUrl, fhirVersion, settings, fhirClient),
    });
  }

  // Helper methods for batch validation (deduplication, grouping, preloading, chunking)
  // have been extracted to batch-utils.ts to keep this orchestrator focused and compliant
  // with global.mdc file size guidelines.

  /**
   * Validate resource against a profile
   */
  async validate(
    resource: any,
    profileUrl?: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike
  ): Promise<ValidationIssue[]> {
    await this.waitForInitialization();
    this.applyRuntimeSettings(settings as ValidationSettings | undefined);

    return validateRecordsResource(
      { resource, profileUrl, fhirVersion, settings, fhirClient },
      {
        sdLoader: this.sdLoader,
        profileCache: this.profileCache,
        snapshotGenerator: this.snapshotGenerator,
        structuralExecutor: this.structuralExecutor,
        profileExecutor: this.profileExecutor,
        terminologyExecutor: this.terminologyExecutor,
        invariantExecutor: this.invariantExecutor,
        customRuleExecutor: this.customRuleExecutor,
        metadataExecutor: this.metadataExecutor,
        referenceExecutor: this.referenceExecutor,
        bestPracticeValidator: this.bestPracticeValidator,
        strictMode: this.config.strictMode || false,
        validateBundleEntriesIfNeeded: (target, version) =>
          this.validateBundleEntriesIfNeeded(target, version),
      },
    );
  }

  private async validateBundleEntriesIfNeeded(
    resource: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]> {
    if (resource.resourceType !== 'Bundle' || !Array.isArray(resource.entry)) {
      return [];
    }
    return this.validateBundleEntries(resource, fhirVersion, 1);
  }

  /** Max depth for recursive Bundle.entry[].resource validation */
  private static readonly BUNDLE_ENTRY_MAX_DEPTH = 3;

  /**
   * Validate basic structure - validates against profiles declared in meta.profile
   * Falls back to base FHIR profile if no profiles are declared
   */
  async validateStructure(
    resource: any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    recursionDepth: number = 0
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    return validateResourceStructure(resource, fhirVersion, recursionDepth, {
      sdLoader: this.sdLoader,
      profileCache: this.profileCache,
      snapshotGenerator: this.snapshotGenerator,
      structuralExecutor: this.structuralExecutor,
      questionnaireRegistry: this.questionnaireRegistry,
      maxBundleEntryDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      validateBundleEntries: (bundle, version, nextDepth) =>
        this.validateBundleEntries(bundle, version, nextDepth),
    });
  }

  /**
   * Recursively validate each `Bundle.entry[].resource` against its own
   * profile(s). Phase 5 of the conformance execution plan.
   *
   * The Java reference validator runs a full validation pass on every
   * entry resource and emits issues whose `expression` is prefixed with
   * `Bundle.entry[i].resource/*ResourceType/id*\/.xyz`. Records matches
   * that shape by calling `validateStructure` on the entry resource and
   * rewriting the `path` of each returned issue.
   */
  private async validateBundleEntries(
    bundle: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number
  ): Promise<ValidationIssue[]> {
    return validateBundleEntryResources(bundle, fhirVersion, recursionDepth, {
      sdLoader: this.sdLoader,
      profileCache: this.profileCache,
      snapshotGenerator: this.snapshotGenerator,
      maxDepth: RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH,
      structuralExecutor: this.structuralExecutor,
      validateResource: (resource, profileUrl, version) => this.validate(resource, profileUrl, version),
      validateNestedBundleEntries: (nestedBundle, version, nextDepth) =>
        this.validateBundleEntries(nestedBundle, version, nextDepth),
    });
  }

  /**
   * Validate metadata fields
   */
  async validateMetadata(
    resource: any
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    try {
      // Delegate to metadata executor
      return await this.metadataExecutor.validate({ resource });
    } catch (error) {
      logger.error('[RecordsValidator] Metadata validation error:', error);
      return [createValidationErrorIssue(
        'metadata',
        'validation-error',
        `Metadata validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  /**
   * Validate references in a FHIR resource
   * 
   * @param resource - FHIR resource to validate
   * @param fhirClient - Optional FHIR client for reference resolution
   * @param fhirVersion - FHIR version (R4, R5, R6)
   * @returns Array of validation issues
   */
  async validateReferences(
    resource: any,
    fhirClient?: FhirClientLike,
    fhirVersion?: 'R4' | 'R5' | 'R6'
  ): Promise<ValidationIssue[]> {
    try {
      // Delegate to reference executor
      return await this.referenceExecutor.validate({
        resource,
        fhirClient,
        fhirVersion
      });
    } catch (error) {
      logger.error('[RecordsValidator] Reference validation error:', error);
      return [createValidationErrorIssue(
        'reference',
        'validation-error',
        `Reference validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  /**
   * Check if a profile is supported
   */
  isProfileSupported(profileUrl: string): boolean {
    // Check if profile is in cache or can be loaded
    return this.sdLoader.isProfileAvailable(profileUrl);
  }

  /**
   * Get list of all supported profiles
   */
  getSupportedProfiles(): string[] {
    return this.sdLoader.getAvailableProfiles();
  }

  /**
   * Get StructureDefinitionLoader instance (for status/configuration access)
   */
  getSdLoader(): StructureDefinitionLoader {
    return this.sdLoader;
  }

  /**
   * Resolve a profile URL to a StructureDefinition with a generated snapshot,
   * using the same cache + snapshot-generation path the validator takes at
   * run time. Returns null when the profile can't be loaded.
   */
  async loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<StructureDefinition | null> {
    return loadProfileWithSnapshot(
      this.sdLoader,
      this.profileCache,
      this.snapshotGenerator,
      profileUrl,
      fhirVersion,
    );
  }

  /**
   * Register a Questionnaire resource so it can be consulted when
   * validating a QuestionnaireResponse that references it via
   * `QR.questionnaire`. Used by the conformance runner to preload
   * supporting Questionnaires and by callers that want to inject a
   * questionnaire at runtime.
   */
  registerQuestionnaire(questionnaire: any): boolean {
    return this.questionnaireRegistry.register(questionnaire);
  }

  /**
   * Look up a previously-registered Questionnaire by its canonical URL,
   * resource reference, or contained reference. Returns null when
   * nothing is registered under the given key.
   */
  getQuestionnaire(canonicalOrRef: string | undefined | null): any | null {
    return this.questionnaireRegistry.get(canonicalOrRef);
  }

  /**
   * Apply validation settings that affect profile loading at runtime.
   * This keeps the singleton validator aligned with per-request UI settings.
   */
  private applyRuntimeSettings(settings?: ValidationSettings): void {
    if (!settings) {
      return;
    }

    applyProfileLoadingSettings(this.sdLoader, settings);
    this.configureTerminologyResolution(buildTerminologyResolutionConfig(settings));
  }

  /**
   * Configure terminology resolution strategy
   * Call this when settings change to update how terminology validation resolves codes
   * 
   * @param config - Terminology resolution configuration
   * @param config.strategy - 'local-first' | 'server-first' | 'local-only'
   * @param config.serverUrl - URL of terminology server (for server-first)
   */
  configureTerminologyResolution(config: TerminologyResolutionConfig): void {
    this.terminologyExecutor.configureResolution(config);
    this.structuralExecutor.configureTerminologyResolution(config);
    this.valuesetValidator.setResolutionConfig(config);
    const scopedCount = config.servers?.filter(s => s.preferredSystems && s.preferredSystems.length > 0).length || 0;
    logger.info(
      `[RecordsValidator] Terminology resolution configured: strategy=${config.strategy}, ` +
      `server=${config.serverUrl}, auth=${config.auth?.type || 'none'}, ` +
      `servers=${config.servers?.length || 0} (${scopedCount} with scope routing)`,
    );
  }

  /**
   * Clear terminology cache (call on settings change)
   */
  clearTerminologyCache(): void {
    this.terminologyExecutor.clearCache();
    this.valuesetValidator.clearCache();
    logger.info('[RecordsValidator] Terminology caches cleared');
  }

  /**
   * Clear the in-memory StructureDefinition cache. Call on profile-source
   * / package-pin changes so re-resolution picks up new definitions.
   */
  clearProfileCache(): void {
    this.profileCache.clear();
    logger.info('[RecordsValidator] Profile cache cleared');
  }

  /**
   * Evict a single profile URL from snapshot + L1 caches.
   * Used by the conformance runner when re-registering an external profile
   * with the same URL but different content between test cases.
   */
  evictProfile(profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): void {
    this.snapshotGenerator.evict(profileUrl);
    this.profileCache.delete(`${profileUrl}:${fhirVersion}:snapshot`);
  }

  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.sdLoader.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.sdLoader.getPinnedCanonicalCount();
  }

  /**
   * Cross-Resource Anomaly Detection (Phase C differentiator).
   *
   * Analyses a batch of resources AFTER per-resource validation and
   * surfaces cohort-level data-quality issues that single-resource
   * validators cannot detect:
   *
   *   - Missing-field anomalies ("95% have effectiveDateTime, these 12 don't")
   *   - Duplicate resources (same subject + code + date)
   *   - Orphan references (target not in batch)
   *
   * HAPI cannot do this — it validates one resource at a time. This
   * is what justifies Records' existence beyond speed.
   *
   * @param resources — the full batch (same array you'd pass to validateBatch)
   * @param config — optional overrides for detection thresholds
   * @returns array of anomaly findings, sorted by confidence
   */
  detectAnomalies(
    resources: any[],
    config?: Partial<AnomalyDetectorConfig>,
  ): AnomalyFinding[] {
    if (config) {
      return new AnomalyDetector(config).detect(resources);
    }
    return this.anomalyDetector.detect(resources);
  }
}
