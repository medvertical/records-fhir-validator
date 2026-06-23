/**
 * Validation Settings and Configuration
 * 
 * Types related to validation settings, configuration, and resource type filtering.
 * Extracted from shared/validation-settings.ts
 */

import type {
  ValidationSeverity,
  ValidationStrictness,
  FHIRVersion
} from './enums';

import type {
  TerminologyServer,
  MiiValidationSettings,
  CircuitBreakerConfig,
  AdvancedTerminologyConfig,
} from './settings-terminology';

export type {
  TerminologyAuthConfig,
  TerminologyServer,
  MiiTerminologyMode,
  MiiPreset,
  MiiValidationSettings,
  CircuitBreakerConfig,
  AdvancedTerminologyConfig,
} from './settings-terminology';

// ============================================================================
// Validation Aspect Configuration
// ============================================================================

/**
 * Configuration for a single validation aspect
 */
export interface ValidationAspectConfig {
  [key: string]: unknown;
  /** Whether this validation aspect is enabled */
  enabled: boolean;

  /** Severity level for issues found by this aspect
   * - 'inherit': Use the original severity from validation messages (default)
   * - 'error'/'warning'/'info': Override all messages from this aspect to this severity
   */
  severity: ValidationSeverity | 'inherit';

  /** Validation engine to use for this aspect (optional - defaults per aspect type) */
  engine?: string;
}

// ============================================================================
// Profile Sources Configuration
// ============================================================================

/**
 * Configuration for remote profile sources
 * Local sources (bundled, DB cache) are always enabled
 */
export interface ProfileSourcesConfig {
  /** Use Simplifier.net API to fetch profiles */
  simplifier: boolean;

  /** Use FHIR Package Registry (packages.fhir.org) to download profile packages */
  packageRegistry: boolean;
}

// ============================================================================
// Advisor Rules
// ============================================================================

/**
 * Match criteria for an advisor rule.
 * All specified fields must match for the rule to apply.
 */
export interface AdvisorRuleMatch {
  code?: string | string[];
  path?: string | string[];
  message?: string;
  aspect?: string | string[];
  severity?: string;
  profile?: string;
  resourceType?: string | string[];
}

/**
 * Transformation to apply when an advisor rule matches.
 */
export interface AdvisorRuleTransform {
  severity?: 'error' | 'warning' | 'information' | 'info';
  message?: string;
}

/**
 * Post-validation advisor rule for severity overrides and suppressions.
 * Applied after strictness filtering, before persistence.
 */
export interface AdvisorRule {
  id: string;
  action: 'suppress' | 'override-severity' | 'override-message';
  match: AdvisorRuleMatch;
  transform?: AdvisorRuleTransform;
  reason?: string;
  enabled?: boolean;
}

// ============================================================================
// Validation Settings
// ============================================================================

/**
 * Main validation settings interface
 */
export interface ValidationSettings {
  [key: string]: unknown;
  /** 8 Validation Aspects (Structural, Profile, Terminology, Reference, Invariant, Custom Rules, Metadata, Anomaly) */
  aspects: {
    structural: ValidationAspectConfig;
    profile: ValidationAspectConfig;
    terminology: ValidationAspectConfig;
    reference: ValidationAspectConfig;
    invariant: ValidationAspectConfig;
    custom_rule: ValidationAspectConfig;
    metadata: ValidationAspectConfig;
    anomaly: ValidationAspectConfig;
  };

  /** Performance Settings (only 2 essential fields) */
  performance: {
    maxConcurrent: number; // 1-20, default: 4
    batchSize: number;     // 10-100, default: 50
    enableDeltaSearch?: boolean; // default: true
  };

  /** Resource Type Filtering (essential for performance) */
  resourceTypes: {
    enabled: boolean;           // Whether filtering is active
    includedTypes: string[];    // List of resource types to validate (empty = all)
    excludedTypes: string[];    // List of resource types to exclude
    fhirVersion?: FHIRVersion;  // FHIR version (e.g., 'R4', 'R5')
  };

  /** Multiple Terminology Servers (ordered by priority) */
  terminologyServers?: TerminologyServer[];

  /** MII product preset metadata used in run evidence and quality gates. */
  mii?: MiiValidationSettings;

  /**
   * Terminology Resolution Strategy
   * Controls how terminology validation resolves codes against ValueSets/CodeSystems
   */
  terminologyResolution?: {
    /**
     * Resolution strategy:
     * - 'local-first': Try local packages first, fallback to server (default, offline-capable)
     * - 'server-first': Delegate to terminology server, cache locally (authoritative)
     * - 'local-only': Never contact external servers (air-gapped environments)
     */
    strategy: 'local-first' | 'server-first' | 'local-only';

    /**
     * Server delegation configuration (only used when strategy includes server)
     */
    serverDelegation?: {
      /** Use $expand operation for full ValueSet expansion */
      expandValueSets: boolean;
      /** Use $validate-code for per-code validation */
      validateCodes: boolean;
      /** Cache server responses locally */
      cacheResults: boolean;
      /** Cache expiration in seconds (default: 3600) */
      cacheTTLSeconds: number;
    };

    /**
     * Experimental two-phase terminology expansion.
     * Shadow mode measures local expansion coverage without changing results.
     * Enforce mode may use complete local expansions as the validation result.
     */
    twoPhaseExpansion?: {
      enabled: boolean;
      mode: 'shadow' | 'enforce';
      logMismatches?: boolean;
    };

    /**
     * Fail-open behavior for unknown codes
     * - 'required-closed': Fail closed for required bindings, open for others (recommended)
     * - 'all-open': All unknown codes pass (current default)
     * - 'all-closed': All unknown codes fail (strict)
     */
    unknownCodeBehavior?: 'required-closed' | 'all-open' | 'all-closed';

    /**
     * Surface bindings that cannot be verified (no local expansion, no
     * terminology-server confirmation) as informational issues instead of
     * silently failing open. Off by default — precision-neutral (gap P-3 step b).
     */
    reportUnverifiedBindings?: boolean;

    /**
     * Strict terminology policy: raise unverifiable *required* bindings to
     * warning severity (implies reportUnverifiedBindings). Off by default
     * (gap P-3 step c).
     */
    strictUnverifiedRequiredBindings?: boolean;
  };

  /** Circuit Breaker Configuration */
  circuitBreaker?: CircuitBreakerConfig;

  /** Validation Mode (Online/Offline) for terminology validation */
  mode?: 'online' | 'offline'; // Default: 'online'

  /** Terminology Fallback Configuration (DEPRECATED - use terminologyServers instead) */
  terminologyFallback?: {
    local?: string;  // Local terminology server URL (e.g., http://localhost:8081/fhir)
    remote?: string; // Remote terminology server URL (e.g., https://tx.fhir.org)
  };

  /** Offline Mode Configuration */
  offlineConfig?: {
    ontoserverUrl?: string;     // Local Ontoserver URL
    profileCachePath?: string;  // Path to cached profile packages
  };

  /** Task 4.13: Profile Package Sources Configuration
   * Controls which remote sources are used to fetch profiles (in addition to local cache)
   */
  profileSources?: ProfileSourcesConfig;

  /**
   * Advanced Terminology Validation
   * Optional checks that require additional terminology server calls.
   * All disabled by default for performance.
   */
  advancedTerminology?: AdvancedTerminologyConfig;

  /** Package Download Configuration */
  packageDownload?: {
    versionPolicy: 'prefer-stable' | 'prefer-latest';  // Default: 'prefer-stable'
    pinnedVersions: { [packageId: string]: string };   // Per-package version overrides
    approvedPackages: string[];                        // User-approved package patterns
    requireApproval: boolean;                          // Show approval UI before downloading new packages
    autoDownload: boolean;                             // Enable/disable auto-download
  };

  /** Auto-Revalidation Settings */
  autoRevalidateAfterEdit?: boolean;
  autoRevalidateOnVersionChange?: boolean;
  listViewPollingInterval?: number;


  /** Best Practice Validation Settings */
  enableBestPracticeChecks?: boolean;
  bestPracticeSeverity?: 'warning' | 'info';

  /** 
   * Validation strictness level:
   * - compatibility: lenient validation, fewer warnings for interoperability
   * - standard: balanced validation with strict FHIR conformance (recommended)
   * - strict: comprehensive validation, all rules enforced
   */
  validationStrictness?: ValidationStrictness; // Default: 'standard'

  /** Task 6.6 & 6.7: Recursive Reference Validation Configuration */
  recursiveReferenceValidation?: {
    enabled: boolean;
    maxDepth: number;
    validateExternal: boolean;
    validateContained: boolean;
    validateBundleEntries: boolean;
    excludeResourceTypes?: string[];
    maxReferencesPerResource?: number;
    timeoutMs?: number;
    /**
     * Opt-in (default off): validate a resolvable reference target against the
     * profile named in the element's Reference(targetProfile); non-conformance
     * is reported as a warning (gap P-2 profile conformance).
     */
    validateTargetProfiles?: boolean;
  };

  /** Task 7.12: Multi-Layer Cache Configuration */
  cacheConfig?: {
    layers?: {
      L1?: 'enabled' | 'disabled';
      L2?: 'enabled' | 'disabled';
      L3?: 'enabled' | 'disabled';
    };
    l1MaxSizeMb?: number;
    l2MaxSizeGb?: number;
    l3MaxSizeGb?: number;
    ttl?: {
      validation?: number;
      profile?: number;
      terminology?: number;
      igPackage?: number;
      default?: number;
    };
    enableWarmup?: boolean;
    warmupProfiles?: string[];
    warmupTerminologySystems?: string[];
  };

  /** HAPI FHIR Validator Configuration */
  hapiConfig?: {
    enabled: boolean;
    available?: boolean;
    timeout?: number;
    igPackages?: string[];
    useProcessPool?: boolean;
    poolSize?: number;
    cachePath?: string;
    enableBestPractice?: boolean;
  };

  /** Auto-apply custom rules after validation */
  autoApplyCustomRules?: boolean;

  /** Validation engine preset selection for UI (records, hapi, or custom) */
  engine?: string;

  /**
   * Excluded validation paths.
   * Validation issues matching these canonical paths will be filtered out.
   * Supports exact paths (e.g., 'Practitioner.identifier[0].use') or
   * wildcard patterns (e.g., 'Patient.identifier[*].use').
   */
  excludedPaths?: string[];

  /** Advisor rules for post-validation severity overrides and suppressions */
  advisorRules?: AdvisorRule[];
}

// ============================================================================
// Settings Update and Validation
// ============================================================================

/**
 * Partial settings update interface
 */
export interface ValidationSettingsUpdate {
  aspects?: Partial<ValidationSettings['aspects']>;
  performance?: Partial<ValidationSettings['performance']>;
  resourceTypes?: Partial<ValidationSettings['resourceTypes']>;
  terminologyServers?: TerminologyServer[];
  terminologyResolution?: Partial<ValidationSettings['terminologyResolution']>;
  circuitBreaker?: CircuitBreakerConfig;
  mode?: 'online' | 'offline';
  terminologyFallback?: {
    local?: string;
    remote?: string;
  };
  offlineConfig?: {
    ontoserverUrl?: string;
    profileCachePath?: string;
  };
  profileSources?: ProfileSourcesConfig;
  packageDownload?: Partial<ValidationSettings['packageDownload']>;
  autoRevalidateAfterEdit?: boolean;
  autoRevalidateOnVersionChange?: boolean;
  listViewPollingInterval?: number;
  enableBestPracticeChecks?: boolean;
  bestPracticeSeverity?: 'warning' | 'info';
  validationStrictness?: ValidationStrictness;
  recursiveReferenceValidation?: Partial<ValidationSettings['recursiveReferenceValidation']>;
  cacheConfig?: Partial<ValidationSettings['cacheConfig']>;
  hapiConfig?: Partial<ValidationSettings['hapiConfig']>;
  excludedPaths?: string[];
  autoApplyCustomRules?: boolean;
  advisorRules?: AdvisorRule[];
}

/**
 * Validation result for settings validation
 */
export interface ValidationSettingsValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Resource Type Configuration
// ============================================================================

/**
 * FHIR resource type configuration
 */
export interface FHIRResourceTypeConfig {
  version: FHIRVersion;
  includedTypes: string[];
  excludedTypes: string[];
  totalCount: number;
}

// ============================================================================
// Performance Limits
// ============================================================================

/**
 * Performance limits constants
 */
export const PERFORMANCE_LIMITS = {
  maxConcurrent: {
    min: 1,
    max: 20,
    default: 5
  },
  batchSize: {
    min: 10,
    max: 100,
    default: 50
  }
} as const;
