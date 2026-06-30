/**
 * Records Validator - Main Export
 * 
 * Pure JavaScript/TypeScript FHIR Validation Engine
 * 
 * Usage:
 *   import { recordsValidator } from '@records-fhir/validator';
 *   const issues = await recordsValidator.validate(resource, profileUrl);
 */

import type { RecordsValidator } from './core/validator-engine';
import type { FhirClientLike } from './core/profile-loader-utils';
import type { ValidationIssue, ValidationSettings } from './types';
import type { TerminologyResolutionConfig } from './validators/valueset-validator';
import type { AnomalyDetectorConfig, AnomalyFinding } from './validators/anomaly-detector';
import {
  toInternalFhirVersion,
  validateAllResources,
} from './public-validation-api';
import type {
  PublicBatchValidationOptions,
  PublicFhirVersion,
  PublicValidationInput,
  PublicValidationResult,
} from './public-validation-api';

// Lazy import to avoid circular dependencies
// Import RecordsValidator class only when needed
let _recordsValidatorInstance: RecordsValidator | null = null;

// Export validator classes for testing and advanced usage
export { ExtensionValidator } from './validators/extension-validator';
export { SlicingValidator } from './validators/slicing-validator';
export { ValueSetValidator } from './validators/valueset-validator';
export { ConstraintValidator } from './validators/constraint-validator';
export type { FHIRPathConstraintDiagnostics } from './validators/constraint-validator';
export { SnapshotGenerator } from './core/snapshot-generator';

/**
 * Get singleton instance of RecordsValidator
 * Lazy initialization to avoid circular dependencies
 */
async function getRecordsValidator(): Promise<RecordsValidator> {
  if (!_recordsValidatorInstance) {
    const { RecordsValidator } = await import('./core/validator-engine');
    const { logger } = await import('./logger');
    _recordsValidatorInstance = new RecordsValidator({
      enableCaching: true,
      strictMode: false,
      timeout: 30000, // Increased for package downloads
      // autoDownload is controlled by ValidationSettings.packageDownload.autoDownload
      allowedPackages: [
        // Core FHIR
        'hl7.fhir.r4.core',
        'hl7.fhir.r4.examples',
        // Germany: gematik ISiK (hospitals)
        'de.gematik.*',
        // Germany: MII Core Data Set (university hospitals)
        'de.medizininformatikinitiative.*',
        'de.medizininformatik-initiative.*',
        // Germany: KBV (ambulatory care)
        'kbv.*',
        // Germany: HL7 Germany base profiles
        'de.basisprofil.*',
        // Germany: RKI DEMIS (infectious disease reporting)
        'rki.demis.*',
        // HL7 Europe (EHDS)
        'hl7.eu.*',
        // US Core + US realm
        'hl7.fhir.us.*',
        // UK Core
        'uk.nhsdigital.*',
        'fhir.r4.ukcore.*',
        'hl7.fhir.uk.*',
        'uk.core',
        'uk.core.r4.v2',
        // Australian realm packages
        'hl7.fhir.au.*',
        // Dutch (Nictiz, IKNL)
        'nictiz.*',
        'iknl.*',
        // IHE + international
        'ihe.*',
        'hl7.fhir.uv.*',
      ]
      // packageCachePath is set automatically in constructor
    });
    logger.info('[RecordsValidator] Validator initialized');
  }
  return _recordsValidatorInstance;
}

/**
 * Walk a Questionnaire's items and load any `answerValueSet` references
 * into the local valueset-cache so the synchronous Coding display-match
 * check has CodeSystems available without performing disk I/O at
 * validation time.
 */
interface QuestionnaireItemLike {
  answerValueSet?: unknown;
  item?: unknown;
}

interface QuestionnaireLike {
  item?: unknown;
}

async function prewarmAnswerValueSets(questionnaire: QuestionnaireLike): Promise<void> {
  const urls = new Set<string>();
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const candidate = item as QuestionnaireItemLike;
      if (typeof candidate.answerValueSet === 'string') {
        urls.add(candidate.answerValueSet);
      }
      walk(candidate.item);
    }
  };
  walk(questionnaire?.item);
  if (urls.size === 0) return;

  try {
    const { ValueSetPackageLoader } = await import(
      './validators/valueset-package-loader'
    );
    const { valueSetCache } = await import('./validators/valueset-cache');
    const loader = new ValueSetPackageLoader(valueSetCache);
    for (const url of urls) {
      await loader.loadValueSet(url);
    }
  } catch {
    // Best-effort prewarm — failures silently degrade the display check
    // to "cache miss, skip" rather than breaking QR validation.
  }
}

export { toInternalFhirVersion } from './public-validation-api';
export type {
  PublicBatchValidationOptions,
  PublicFhirVersion,
  PublicValidationInput,
  PublicValidationRequest,
  PublicValidationResult,
} from './public-validation-api';

export interface RecordsValidatorSingleton {
  validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion?: PublicFhirVersion,
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
  ): Promise<ValidationIssue[]>;
  validateMetadata(...args: Parameters<RecordsValidator['validateMetadata']>): ReturnType<RecordsValidator['validateMetadata']>;
  validateStructure(...args: Parameters<RecordsValidator['validateStructure']>): ReturnType<RecordsValidator['validateStructure']>;
  validateBatch(...args: Parameters<RecordsValidator['validateBatch']>): ReturnType<RecordsValidator['validateBatch']>;
  validateAll(inputs: PublicValidationInput[], options?: PublicBatchValidationOptions): Promise<PublicValidationResult[]>;
  isCreated(): boolean;
  isInitialized(): Promise<boolean>;
  isAvailable(): boolean;
  isProfileSupported(...args: Parameters<RecordsValidator['isProfileSupported']>): ReturnType<RecordsValidator['isProfileSupported']>;
  waitForInitialization(): ReturnType<RecordsValidator['waitForInitialization']>;
  getSdLoader(): Promise<ReturnType<RecordsValidator['getSdLoader']>>;
  loadProfileWithSnapshot(...args: Parameters<RecordsValidator['loadProfileWithSnapshot']>): ReturnType<RecordsValidator['loadProfileWithSnapshot']>;
  registerQuestionnaire(questionnaire: QuestionnaireLike): Promise<boolean>;
  getQuestionnaire(...args: Parameters<RecordsValidator['getQuestionnaire']>): ReturnType<RecordsValidator['getQuestionnaire']>;
  configureTerminologyResolution(config: TerminologyResolutionConfig): Promise<ReturnType<RecordsValidator['configureTerminologyResolution']>>;
  clearTerminologyCache(): Promise<ReturnType<RecordsValidator['clearTerminologyCache']>>;
  getConstraintDiagnostics(): Promise<ReturnType<RecordsValidator['getConstraintDiagnostics']>>;
  clearConstraintDiagnostics(): Promise<ReturnType<RecordsValidator['clearConstraintDiagnostics']>>;
  clearProfileCache(): Promise<ReturnType<RecordsValidator['clearProfileCache']> | undefined>;
  evictProfile(...args: Parameters<RecordsValidator['evictProfile']>): ReturnType<RecordsValidator['evictProfile']> | undefined;
  setPinnedCanonicals(...args: Parameters<RecordsValidator['setPinnedCanonicals']>): Promise<ReturnType<RecordsValidator['setPinnedCanonicals']>>;
  getPinnedCanonicalCount(): ReturnType<RecordsValidator['getPinnedCanonicalCount']>;
  detectAnomalies(resources: unknown[], config?: Partial<AnomalyDetectorConfig>): Promise<AnomalyFinding[]>;
}

/**
 * RecordsValidator singleton with lazy initialization
 * Methods are proxied to avoid breaking existing code
 */
export const recordsValidator: RecordsValidatorSingleton = {
  async validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion?: PublicFhirVersion,
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
  ) {
    const instance = await getRecordsValidator();
    const mapped = fhirVersion ? toInternalFhirVersion(fhirVersion) : undefined;
    return instance.validate(resource, profileUrl, mapped, settings, fhirClient);
  },
  async validateMetadata(...args) {
    const instance = await getRecordsValidator();
    return instance.validateMetadata(...args);
  },
  async validateStructure(...args) {
    const instance = await getRecordsValidator();
    return instance.validateStructure(...args);
  },
  async validateBatch(...args) {
    const instance = await getRecordsValidator();
    return instance.validateBatch(...args);
  },
  async validateAll(inputs, options) {
    const instance = await getRecordsValidator();
    return validateAllResources({
      validate: (resource, profileUrl, fhirVersion, settings, fhirClient) =>
        instance.validate(resource, profileUrl, fhirVersion, settings, fhirClient),
      validateBatch: (resources, batchOptions) =>
        instance.validateBatch(resources as any[], batchOptions),
    }, inputs, options);
  },
  /**
   * Check if validator singleton has been created
   * Note: This is synchronous and doesn't trigger initialization
   */
  isCreated() {
    return _recordsValidatorInstance !== null;
  },
  /**
   * Check if validator is fully initialized (singleton created AND initialization complete)
   * Use this to detect warm starts and skip re-initialization
   */
  async isInitialized() {
    if (!_recordsValidatorInstance) {
      return false;
    }
    // Validator exists, check if it's available (init complete)
    return _recordsValidatorInstance.isAvailable();
  },
  isAvailable() {
    return _recordsValidatorInstance !== null; // Only true if singleton exists
  },
  isProfileSupported(...args) {
    if (!_recordsValidatorInstance) {
      return false; // Not initialized yet
    }
    return _recordsValidatorInstance.isProfileSupported(...args);
  },
  async waitForInitialization() {
    const instance = await getRecordsValidator();
    return instance.waitForInitialization();
  },
  async getSdLoader() {
    const instance = await getRecordsValidator();
    await instance.waitForInitialization();
    return instance.getSdLoader();
  },
  async loadProfileWithSnapshot(profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4') {
    const instance = await getRecordsValidator();
    await instance.waitForInitialization();
    return instance.loadProfileWithSnapshot(profileUrl, fhirVersion);
  },
  /**
   * Register a supporting Questionnaire so subsequent QR validations can
   * look it up and evaluate SDC extensions (minValue/maxValue/…) against
   * the item definitions. Primarily used by the conformance runner.
   *
   * Pre-warms the ValueSet + CodeSystem cache for any `answerValueSet`
   * the questionnaire references so the synchronous Coding display-match
   * check in QR validation can consult the local CodeSystem.
   */
  async registerQuestionnaire(questionnaire) {
    const instance = await getRecordsValidator();
    await instance.waitForInitialization();
    const ok = instance.registerQuestionnaire(questionnaire);
    if (ok) {
      await prewarmAnswerValueSets(questionnaire);
    }
    return ok;
  },
  /** Look up a previously-registered Questionnaire by canonical URL. */
  async getQuestionnaire(canonicalOrRef: string | undefined | null) {
    const instance = await getRecordsValidator();
    await instance.waitForInitialization();
    return instance.getQuestionnaire(canonicalOrRef);
  },
  /**
   * Configure terminology resolution strategy
   * Call when settings change to update how terminology validation resolves codes
   */
  async configureTerminologyResolution(config) {
    const instance = await getRecordsValidator();
    return instance.configureTerminologyResolution(config);
  },
  /**
   * Clear terminology caches (call on settings change)
   */
  async clearTerminologyCache() {
    const instance = await getRecordsValidator();
    return instance.clearTerminologyCache();
  },

  async getConstraintDiagnostics() {
    const instance = await getRecordsValidator();
    return instance.getConstraintDiagnostics();
  },

  async clearConstraintDiagnostics() {
    const instance = await getRecordsValidator();
    return instance.clearConstraintDiagnostics();
  },

  /**
   * Clear the StructureDefinition cache (call on profile-source /
   * package-pin settings changes so re-resolution picks up new
   * definitions).
   */
  async clearProfileCache() {
    // If the validator hasn't been instantiated yet there's nothing to
    // clear — skip the lazy init to avoid booting the engine during
    // cache invalidation.
    if (!_recordsValidatorInstance) return;
    return _recordsValidatorInstance.clearProfileCache();
  },

  /**
   * Evict a single profile from snapshot + L1 caches by URL.
   * Used by the conformance runner when re-registering an external
   * profile with the same URL but different content between test cases.
   */
  evictProfile(profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4') {
    if (!_recordsValidatorInstance) return;
    return _recordsValidatorInstance.evictProfile(profileUrl, fhirVersion);
  },

  async setPinnedCanonicals(...args) {
    const instance = await getRecordsValidator();
    return instance.setPinnedCanonicals(...args);
  },

  getPinnedCanonicalCount(): number {
    if (!_recordsValidatorInstance) return 0;
    return _recordsValidatorInstance.getPinnedCanonicalCount();
  },

  /**
   * Cross-Resource Anomaly Detection (Phase C).
   *
   * Analyses a batch of resources for cohort-level data-quality issues
   * like missing-field outliers, duplicate resources, and orphan
   * references. Does NOT require prior per-resource validation — the
   * anomaly detector works on raw resources.
   *
   * @param resources — array of FHIR resources to analyse
   * @param config — optional detection threshold overrides
   */
  async detectAnomalies(resources, config) {
    const instance = await getRecordsValidator();
    return instance.detectAnomalies(resources, config);
  }
};

/**
 * Wait for the Records Validator to finish initialization
 * Call this during server startup to ensure profiles are loaded before handling requests
 */
export async function ensureRecordsValidatorReady(): Promise<void> {
  const instance = await getRecordsValidator();
  await instance.waitForInitialization();
}

// Export class for custom instances (lazy to avoid circular dependencies)
export async function getRecordsValidatorClass() {
  const { RecordsValidator } = await import('./core/validator-engine');
  return RecordsValidator;
}

// Export types (types don't cause circular dependencies)
export type { RecordsValidatorConfig, ValidationContext } from './core/validator-engine';
export type { StructureDefinition, ElementDefinition } from './core/structure-definition-types';

// ============================================================================
// Standalone-package surface
// ============================================================================
//
// What the eventual `@records-fhir/validator` npm package exposes to
// external callers. The bundled `recordsValidator` singleton above is
// server-bound (auto-imports the server's Winston logger and installs
// a noop ProfileSource); standalone callers construct their own
// `RecordsValidator` instance and wire the engine themselves through
// the DI setters re-exported here.
//
// Standalone usage:
// ```ts
// import {
//   getRecordsValidatorClass,
//   setEngineLogger,
//   setProfileSource,
//   setCustomRulesSource,
//   createFilesystemProfileSource,
// } from '@records-fhir/validator';
//
// setProfileSource(createFilesystemProfileSource({
//   packageDirs: ['./fhir-packages'],
// }));
// const RecordsValidator = await getRecordsValidatorClass();
// const validator = new RecordsValidator({ bundledProfilesPath: '...' });
// ```

export { setEngineLogger } from './logger';
export type { EngineLogger } from './logger';
export {
    setProfileSource,
    setCustomRulesSource,
    getProfileSource,
    getCustomRulesSource,
} from './persistence';
export type {
    ProfileSource,
    ProfileResolutionEntry,
    CustomRulesSource,
    EngineCustomRule,
} from './persistence';
export {
    createFilesystemProfileSource,
} from './persistence/filesystem-profile-source';
export type { FilesystemProfileSourceOptions } from './persistence/filesystem-profile-source';

// Issue helpers — fix-suggestions catalog + applier (D-1)
export {
    type FixSuggestion,
    type CreateIssueParams,
    FixSuggestions,
    getFixSuggestion,
    formatFixSuggestion,
    createValidationIssue,
    applyFixPatch,
    type FixApplyResult,
    issueFingerprint,
    issueMatchesAnchor,
    issuePathMatchesPattern,
    stableIssues,
    summarizeIssueAnchors,
    summarizeIssueFingerprints,
    type ExpectedIssueAnchor,
    type StableIssueSummaryOptions,
} from './issues';

// FHIRPath sandbox — static safety pre-flight for Custom Rules (P-3)
export {
    checkFhirpathSandbox,
    type SandboxLimits,
    type SandboxResult,
} from './validators/fhirpath-sandbox';
