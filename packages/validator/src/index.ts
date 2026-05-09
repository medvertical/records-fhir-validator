/**
 * Records Validator - Main Export
 * 
 * Pure JavaScript/TypeScript FHIR Validation Engine
 * 
 * Usage:
 *   import { recordsValidator } from '@records-fhir/validator';
 *   const issues = await recordsValidator.validate(resource, profileUrl);
 */

// Lazy import to avoid circular dependencies
// Import RecordsValidator class only when needed
let _recordsValidatorInstance: any = null;

// Export validator classes for testing and advanced usage
export { ExtensionValidator } from './validators/extension-validator';
export { SlicingValidator } from './validators/slicing-validator';
export { ValueSetValidator } from './validators/valueset-validator';
export { SnapshotGenerator } from './core/snapshot-generator';

/**
 * Get singleton instance of RecordsValidator
 * Lazy initialization to avoid circular dependencies
 */
async function getRecordsValidator() {
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
async function prewarmAnswerValueSets(questionnaire: any): Promise<void> {
  const urls = new Set<string>();
  const walk = (items: any[] | undefined): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item?.answerValueSet && typeof item.answerValueSet === 'string') {
        urls.add(item.answerValueSet);
      }
      if (item?.item) walk(item.item);
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

/**
 * Public-API FHIR version literal. R4B is accepted on every entry
 * point and routed internally as R4: the records engine validates R4B
 * resources against the same StructureDefinitions and FHIRPath context
 * that R4 uses, which matches the R4B maintenance-release semantics.
 * R4B-specific package bundling (`hl7.fhir.r4b.core`) and a separate
 * R4B FHIRPath context are tracked under K-2 in the strategic roadmap.
 */
export type PublicFhirVersion = 'R4' | 'R4B' | 'R5' | 'R6';

/** Map a public-API FHIR version to the internal validator's accepted version. */
export function toInternalFhirVersion(v: PublicFhirVersion): 'R4' | 'R5' | 'R6' {
  return v === 'R4B' ? 'R4' : v;
}

/**
 * RecordsValidator singleton with lazy initialization
 * Methods are proxied to avoid breaking existing code
 */
export const recordsValidator = {
  async validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion?: PublicFhirVersion,
    ...rest: unknown[]
  ) {
    const instance = await getRecordsValidator();
    const mapped = fhirVersion ? toInternalFhirVersion(fhirVersion) : undefined;
    return instance.validate(resource, profileUrl, mapped, ...rest);
  },
  async validateMetadata(...args: any[]) {
    const instance = await getRecordsValidator();
    return instance.validateMetadata(...args);
  },
  async validateStructure(...args: any[]) {
    const instance = await getRecordsValidator();
    return instance.validateStructure(...args);
  },
  async validateBatch(...args: any[]) {
    const instance = await getRecordsValidator();
    return instance.validateBatch(...args);
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
  isProfileSupported(...args: any[]) {
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
  async registerQuestionnaire(questionnaire: any) {
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
  async configureTerminologyResolution(config: {
    strategy: 'local-first' | 'server-first' | 'local-only';
    serverUrl?: string;
    auth?: {
      type: 'none' | 'basic' | 'bearer' | 'oauth2' | 'mtls';
      username?: string;
      password?: string;
      token?: string;
      clientId?: string;
      clientSecret?: string;
      scope?: string;
      tokenUrl?: string;
      clientCert?: string;
      clientCertPath?: string;
      clientKey?: string;
      clientKeyPath?: string;
      caCert?: string;
      caCertPath?: string;
      passphrase?: string;
      rejectUnauthorized?: boolean;
    };
    servers?: Array<{
      id: string;
      url: string;
      enabled: boolean;
      fhirVersions: ('R4' | 'R5' | 'R6')[];
      preferredSystems?: string[];
      circuitOpen?: boolean;
      authConfig?: {
        type: 'none' | 'basic' | 'bearer' | 'oauth2' | 'mtls';
        username?: string;
        password?: string;
        token?: string;
        clientId?: string;
        clientSecret?: string;
        scope?: string;
        tokenUrl?: string;
        clientCert?: string;
        clientCertPath?: string;
        clientKey?: string;
        clientKeyPath?: string;
        caCert?: string;
        caCertPath?: string;
        passphrase?: string;
        rejectUnauthorized?: boolean;
      };
    }>;
    serverDelegation?: {
      expandValueSets: boolean;
      validateCodes: boolean;
      cacheResults: boolean;
      cacheTTLSeconds: number;
    };
  }) {
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

  async setPinnedCanonicals(pinned: Map<string, string>) {
    const instance = await getRecordsValidator();
    return instance.setPinnedCanonicals(pinned);
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
  async detectAnomalies(resources: any[], config?: any) {
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
} from './issues';

// FHIRPath sandbox — static safety pre-flight for Custom Rules (P-3)
export {
    checkFhirpathSandbox,
    type SandboxLimits,
    type SandboxResult,
} from './validators/fhirpath-sandbox';
