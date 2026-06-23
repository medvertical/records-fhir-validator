/**
 * ValueSet Types
 * 
 * Shared type definitions for ValueSet validation infrastructure.
 * Extracted from valueset-validator.ts for modularity.
 */

// ============================================================================
// Terminology Resolution
// ============================================================================

/** Terminology resolution strategy */
export type TerminologyResolutionStrategy = 'local-first' | 'server-first' | 'local-only';

/** Auth configuration passed from TerminologyServer.authConfig */
export interface TerminologyApiAuthConfig {
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
}

/**
 * Minimal server descriptor for scope-based routing. Mirrors the
 * `TerminologyServer` shape from `@shared/validation-settings` but
 * avoids a cross-package import here to keep the type graph clean.
 */
export interface TerminologyServerDescriptor {
    id: string;
    url: string;
    enabled: boolean;
    fhirVersions: ('R4' | 'R5' | 'R6')[];
    preferredSystems?: string[];
    circuitOpen?: boolean;
    authConfig?: TerminologyApiAuthConfig;
}

/** Per-call override — pick a specific server for one lookup */
export interface TerminologyServerOverride {
    url: string;
    auth?: TerminologyApiAuthConfig;
}

/** Configuration for terminology resolution */
export interface TerminologyResolutionConfig {
    strategy: TerminologyResolutionStrategy;
    serverUrl?: string;
    /** Auth config for the active server. Undefined = anonymous call. */
    auth?: TerminologyApiAuthConfig;
    /**
     * Full server list from settings. When provided, lookups can be
     * scope-routed: a LOINC code lookup goes to a server whose
     * `preferredSystems` contains `http://loinc.org` before falling
     * back to the configured default. When not provided, the
     * validator uses the single `serverUrl` for all lookups.
     */
    servers?: TerminologyServerDescriptor[];
    serverDelegation?: {
        expandValueSets: boolean;
        validateCodes: boolean;
        cacheResults: boolean;
        cacheTTLSeconds: number;
    };
    twoPhaseExpansion?: {
        enabled: boolean;
        mode: 'shadow' | 'enforce';
        logMismatches?: boolean;
    };
    /**
     * When true, a binding that cannot be verified locally and is not
     * confirmed by a terminology server emits a `terminology-binding-unverified`
     * informational issue instead of silently failing open. Default off —
     * precision-neutral until explicitly enabled (gap P-3 step b).
     */
    reportUnverifiedBindings?: boolean;
    /**
     * Strict terminology policy (gap P-3 step c): when true, an unverifiable
     * *required* binding is raised to `warning` severity instead of the default
     * `information`. Implies `reportUnverifiedBindings`. Extensible/preferred
     * bindings stay informational. Default off.
     */
    strictUnverifiedRequiredBindings?: boolean;
}

/**
 * Tri-state outcome of a code-vs-binding check.
 *
 * `valid`/`invalid` are authoritative. `unverified` means the code is not
 * known to be wrong but could not be confirmed (no local expansion, no
 * terminology server). Callers fail open on `unverified` but may surface it.
 */
export type CodeBindingOutcome = 'valid' | 'invalid' | 'unverified';

export const TERMINOLOGY_UNVERIFIED_REASONS = [
    'empty-expansion',
    'unsupported-filter',
    'unresolvable-snomed-extension-filter',
    'validation-error',
] as const;

export type TerminologyUnverifiedReason = typeof TERMINOLOGY_UNVERIFIED_REASONS[number];

export interface TerminologyReasonCounters {
    total: number;
    byReason: Record<TerminologyUnverifiedReason, number>;
}

export interface TerminologyDiagnostics {
    /** Bindings that failed open because the validator could not prove validity locally or remotely. */
    unverifiedBindings: TerminologyReasonCounters;
    /** Direct ValueSet membership checks that failed open to avoid false negatives. */
    failOpenMembershipChecks: TerminologyReasonCounters;
}

// ============================================================================
// FHIR Resources
// ============================================================================

export interface ValueSetComposeInclude {
    /** CodeSystem URL to include codes from */
    system?: string;
    /** Optional CodeSystem version for this include */
    version?: string;
    /** Explicit list of concepts to include */
    concept?: Array<{ code: string; display?: string }>;
    /** ValueSets to include (deep composition — requires recursive resolution) */
    valueSet?: string[];
    /** Filter expressions, e.g. `concept is-a 22298006` */
    filter?: Array<{ property: string; op: string; value: string }>;
}

export interface ValueSetComposeExclude {
    system?: string;
    version?: string;
    concept?: Array<{ code: string }>;
    valueSet?: string[];
    filter?: Array<{ property: string; op: string; value: string }>;
}

export interface ValueSet {
    resourceType: 'ValueSet';
    url: string;
    version?: string;
    name?: string;
    status: string;
    compose?: {
        include?: ValueSetComposeInclude[];
        exclude?: ValueSetComposeExclude[];
    };
    expansion?: {
        contains?: Array<{
            system?: string;
            code: string;
            display?: string;
            /** Nested concepts (hierarchical expansion) */
            contains?: any[];
        }>;
    };
}

export interface CodeSystemConcept {
    code: string;
    display?: string;
    definition?: string;
    designation?: Array<{
        language?: string;
        use?: {
            system?: string;
            code?: string;
            display?: string;
        };
        value?: string;
    }>;
    concept?: CodeSystemConcept[];
}

export interface CodeSystem {
    resourceType: 'CodeSystem';
    url: string;
    version?: string;
    /**
     * `complete` | `example` | `fragment` | `not-present` | `supplement`.
     * A supplement only adds properties/designations to another CodeSystem.
     */
    content?: 'complete' | 'example' | 'fragment' | 'not-present' | 'supplement';
    /**
     * For `content: supplement`: canonical URL of the base CodeSystem this
     * supplement extends. Supplements contribute properties/designations but
     * the codes they reference must already exist in the base system.
     */
    supplements?: string;
    concept?: CodeSystemConcept[];
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_RESOLUTION_CONFIG: TerminologyResolutionConfig = {
    strategy: 'local-first',
    serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 3600,
    },
};

/**
 * External CodeSystems that should be validated via tx.fhir.org
 * These systems are too large to bundle locally and require server validation
 *
 * ICD and CPT systems are intentionally not listed here. Public terminology
 * servers often expose incomplete/licensed content and can report common valid
 * codes as unknown. Treat those system URLs as known, but only assert code
 * membership when an authoritative ValueSet/CodeSystem is loaded or a scoped
 * terminology server is configured for a binding.
 */
export const EXTERNAL_CODE_SYSTEMS = new Set([
    'http://loinc.org',
    'http://snomed.info/sct',
    'http://www.nlm.nih.gov/research/umls/rxnorm',
]);

/**
 * Check if a CodeSystem requires external validation
 */
export function isExternalCodeSystem(system: string): boolean {
    return EXTERNAL_CODE_SYSTEMS.has(system);
}
