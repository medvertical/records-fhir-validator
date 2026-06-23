/**
 * Terminology Server and MII Configuration Types
 *
 * Extracted from settings.ts to keep that file focused on ValidationSettings itself.
 */

import type { ServerStatus } from './enums';

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
