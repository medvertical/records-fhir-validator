/**
 * Validation Settings and Configuration
 * 
 * Types related to validation settings, configuration, and resource type filtering.
 * Extracted from shared/validation-settings.ts
 */

import type {
  ValidationSeverity,
  ValidationStrictness,
  ServerStatus,
  FHIRVersion
} from './enums';

// ============================================================================
// Validation Aspect Configuration
// ============================================================================

/**
 * Configuration for a single validation aspect
 */
export interface ValidationAspectConfig {
  /** Whether this validation aspect is enabled */
  enabled: boolean;

  /** Severity level for issues found by this aspect
   * - 'inherit': Use the original severity from validation messages (default)
   * - 'error'/'warning'/'info': Override all messages from this aspect to this severity
   */
  severity: ValidationSeverity;

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
  /** Use connected FHIR server to fetch profiles */
  fhirServer: boolean;

  /** Use Simplifier.net API to fetch profiles */
  simplifier: boolean;

  /** Use FHIR Package Registry (packages.fhir.org) to download profile packages */
  packageRegistry: boolean;
}

// ============================================================================
// Terminology Server Configuration
// ============================================================================

/**
 * Authentication configuration for terminology servers
 * Mirrors the FHIR server AuthConfig pattern for consistency
 */
export interface TerminologyAuthConfig {
  /** Authentication type */
  type: 'none' | 'basic' | 'bearer' | 'oauth2' | 'mtls';

  /** Username for basic auth */
  username?: string;

  /** Password for basic auth */
  password?: string;

  /** Static bearer token */
  token?: string;

  /** OAuth2 client ID */
  clientId?: string;

  /** OAuth2 client secret */
  clientSecret?: string;

  /** OAuth2 scope (optional - not all servers require it) */
  scope?: string;

  /** OAuth2 token endpoint URL */
  tokenUrl?: string;

  /** PEM encoded client certificate for mTLS terminology calls */
  clientCert?: string;

  /** Filesystem path to a PEM encoded client certificate */
  clientCertPath?: string;

  /** PEM encoded private key for mTLS terminology calls */
  clientKey?: string;

  /** Filesystem path to a PEM encoded private key */
  clientKeyPath?: string;

  /** Optional PEM encoded CA bundle for the terminology server */
  caCert?: string;

  /** Optional filesystem path to a PEM encoded CA bundle */
  caCertPath?: string;

  /** Optional private-key passphrase */
  passphrase?: string;

  /** TLS peer verification toggle. Defaults to true. */
  rejectUnauthorized?: boolean;
}

/**
 * Terminology server configuration
 */
export interface TerminologyServer {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** Base FHIR URL */
  url: string;

  /** Active/inactive toggle */
  enabled: boolean;

  /** Supported FHIR versions (auto-detected) */
  fhirVersions: ('R4' | 'R5' | 'R6')[];

  /** Health status */
  status: ServerStatus;

  /** Circuit breaker failure count */
  failureCount: number;

  /** Last failure timestamp */
  lastFailureTime: number | null;

  /** Circuit breaker state */
  circuitOpen: boolean;

  /** Average response time in ms */
  responseTimeAvg: number;

  /**
   * Unix ms timestamp of the most recent connection test (manual via
   * "Test all" or automatic via liveness probe). Used to stamp the
   * status row in the settings UI so operators can see if metrics
   * are fresh or stale.
   */
  lastTested?: number | null;

  /** Test score (0-100) from terminology-server-test */
  testScore?: number;

  /** Authentication configuration (optional - most public servers don't need auth) */
  authConfig?: TerminologyAuthConfig;

  /**
   * Preferred code systems for this server (optional). When set, the
   * validator routes lookups for these system URLs to this server first
   * before falling back to the generic chain. Enables scope-based
   * routing like "LOINC lookups → fhir.loinc.org, SNOMED → Snowstorm".
   *
   * Example: `['http://loinc.org']` for a LOINC-dedicated server.
   */
  preferredSystems?: string[];
}

// ============================================================================
// MII Preset Metadata
// ============================================================================

export type MiiTerminologyMode = 'mii-local-blaze' | 'mii-ontoserver' | 'mii-hybrid';
export type MiiPreset = 'mii-2026' | 'ehds-2026';

export interface MiiValidationSettings {
  preset: MiiPreset;
  terminologyMode: MiiTerminologyMode;
  /**
   * Optional SHA-256 from the generated .records-lock.json artifact. This is
   * evidence metadata only; package pins remain the executable source.
   */
  packageLockHash?: string;
  /**
   * Guardrail for direct MII Ontoserver use. Bulk validation should prefer
   * mii-hybrid/local-first and only fall back to Ontoserver for the few calls
   * that cannot be answered locally.
   */
  maxOntoserverRequestsPerRun?: number;
  allowHighVolumeOntoserver?: boolean;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Open circuit after N failures */
  failureThreshold: number;

  /** Reset circuit after N milliseconds */
  resetTimeout: number;

  /** Try one request after N milliseconds */
  halfOpenTimeout: number;
}

// ============================================================================
// Advanced Terminology Configuration
// ============================================================================

/**
 * Configuration for advanced terminology validation checks.
 * These features require additional terminology server calls and increase validation time.
 * All are disabled by default.
 */
export interface AdvancedTerminologyConfig {
  /**
   * Hierarchy Validation (SNOMED CT $subsumes)
   * Validates that codes conform to expected concept hierarchies.
   * Example: Condition.code must be a descendant of "Clinical finding" (404684003)
   */
  hierarchyValidation: {
    /** Enable hierarchy checking */
    enabled: boolean;

    /** 
     * Expected parent concept for common contexts.
     * Maps FHIR element paths to SNOMED CT concept IDs.
     * Example: { "Condition.code": "404684003" } 
     */
    contextMappings?: Record<string, string>;
  };

  /**
   * ECL-Based ValueSet Validation
   * Validates codes against SNOMED CT Expression Constraint Language expressions
   * instead of static ValueSets. More flexible but requires server support.
   */
  eclValidation: {
    /** Enable ECL-based validation */
    enabled: boolean;

    /** 
     * Custom ECL expressions for specific paths.
     * Example: { "Condition.code": "<< 404684003" }
     */
    customExpressions?: Record<string, string>;
  };

  /**
   * Cross-Mapping Consistency Validation ($translate)
   * Checks if codes from different systems in the same resource are consistent.
   * For example, warns if ICD-10 code doesn't map to the SNOMED code provided.
   */
  crossMappingValidation: {
    /** Enable cross-mapping consistency checks */
    enabled: boolean;

    /** Strictness: 'warn' emits warnings, 'error' fails validation */
    strictness: 'warn' | 'error';

    /** 
     * System pairs to check for consistency.
     * Default: ICD-10 ↔ SNOMED CT
     */
    checkPairs?: Array<{
      sourceSystem: string;
      targetSystem: string;
    }>;
  };
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
  /** 8 Validation Aspects (Structural, Profile, Terminology, Reference, Invariant, Custom Rules, Metadata, Anomaly) */
  aspects: {
    structural: ValidationAspectConfig;
    profile: ValidationAspectConfig;
    terminology: ValidationAspectConfig;
    reference: ValidationAspectConfig;
    invariant: ValidationAspectConfig;
    customRule: ValidationAspectConfig;
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
     * Fail-open behavior for unknown codes
     * - 'required-closed': Fail closed for required bindings, open for others (recommended)
     * - 'all-open': All unknown codes pass (current default)
     * - 'all-closed': All unknown codes fail (strict)
     */
    unknownCodeBehavior?: 'required-closed' | 'all-open' | 'all-closed';
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
