/**
 * Engine Persistence — Optional Dependencies on Server-Side Data Sources
 *
 * The records-validator engine does not require a database to function.
 * It can validate FHIR resources using only its bundled-profile cache and
 * any IG packages on the local filesystem. Some embedders (notably the
 * Records server) augment that with a database-backed profile cache, an
 * advanced canonical resolver, and a custom-rules table — but those are
 * embedder concerns, not engine concerns.
 *
 * This module defines the boundary the engine speaks to when those
 * extras are available. Embedders implement the interfaces and call
 * `setProfileSource()` / `setCustomRulesSource()` once during boot. With
 * nothing wired up, the engine uses noop defaults and behaves like a
 * standalone offline validator — exactly what the standalone
 * `@records-fhir/validator` npm package needs to ship (S-2 in the
 * validation-engine roadmap).
 *
 * Why this exists
 * ---------------
 * Engine source files used to lazy-import
 * `engine/profile/resolver/profile-cache`,
 * `engine/profile/resolver/profile-resolver`, and `custom-rules-service`
 * directly. Those modules pull in `drizzle-orm` and require
 * `DATABASE_URL` to be set; importing them from a CLI / npm-package
 * context throws at module load. Routing through this boundary is what
 * lets the engine stay DB-optional.
 */

import type { StructureDefinition } from '../core/structure-definition-types';
import type { ValidationSettings } from '../types';

// ============================================================================
// ProfileSource
// ============================================================================

/**
 * Result of a profile lookup that the engine can transfer into its
 * in-memory `ProfileCache`. Mirrors the shape the database-backed
 * profile cache returns today (`canonicalUrl`, `profile`, `version`,
 * `source`) but trimmed to the fields the engine actually consumes.
 */
export interface ProfileResolutionEntry {
    canonicalUrl: string;
    profile: StructureDefinition;
    version?: string;
    source?: string;
}

/**
 * Optional database-backed (or other side-channel) profile lookup.
 * Implemented by the server's `ProfileCache` + `ProfileResolver` stack;
 * left as a noop in the standalone engine package.
 *
 * All methods are optional. The engine checks before calling, so an
 * embedder can implement just the parts they have a backing for.
 */
export interface ProfileSource {
    /**
     * Look up a single profile by canonical URL. Returns null when not
     * found (or when the embedder doesn't implement this lookup).
     *
     * `fhirVersion` is a hint — when the source has multiple FHIR-version
     * variants of the same canonical URL, it should return the matching
     * one (or null when no variant matches).
     */
    findByUrl?(
        url: string,
        fhirVersion?: 'R4' | 'R5' | 'R6',
    ): Promise<StructureDefinition | null>;

    /**
     * Run the embedder's full canonical-resolver pipeline (multi-source,
     * version-pinned, settings-aware) for a single URL. Used by the
     * engine's bulk profile-loader as a second-tier fallback when
     * `findByUrl` and the in-memory cache miss.
     */
    resolveProfile?(
        url: string,
        version: string | undefined,
        settings: ValidationSettings | undefined,
    ): Promise<StructureDefinition | null>;

    /**
     * Bulk-load every profile this source knows about, for warm-up of
     * the engine's in-memory `ProfileCache` at startup. Returns a map
     * keyed by an embedder-defined cache key (the engine just transfers
     * the values).
     */
    loadAllForWarmup?(): Promise<Map<string, ProfileResolutionEntry>>;

    /**
     * Warm up the engine's in-memory `ProfileCache` from the
     * recently-accessed profiles in the underlying source. Called once
     * before bulk validation runs to amortise I/O. Returning the count
     * is informational; the engine logs it but doesn't act on it.
     *
     * `cacheKeyFor` lets the embedder produce keys that match what the
     * in-memory cache expects (`${url}:${fhirVersion}` or
     * `${url}:${fhirVersion}:${version}`); the engine passes a function
     * so the cache-key shape stays a single source of truth.
     */
    warmupRecent?(
        setProfile: (cacheKey: string, sd: StructureDefinition) => void,
        getProfile: (cacheKey: string) => StructureDefinition | null | undefined,
        limit?: number,
    ): Promise<{ warmedUp: number; timeMs: number }>;

    /**
     * Optional remote-fetch fallback for the SDLoader's auto-download
     * path. The server wraps `simplifierClient` here; standalone
     * callers without the simplifier integration skip the lookup
     * silently. Returns null when not found or when the embedder
     * doesn't implement remote fetching.
     */
    fetchExternalProfile?(url: string): Promise<StructureDefinition | null>;

    /**
     * Optional canonical-URL → IG-package mapping for the SDLoader's
     * generic discovery path. Used when an unknown profile URL needs
     * a package guess. The server wraps `getProfilePackageMapper`
     * here; standalone callers skip the lookup.
     */
    findPackageForProfile?(
        url: string,
    ): Promise<{ packageId: string; confidenceScore?: number } | null>;
}

const NOOP_PROFILE_SOURCE: ProfileSource = {};

let activeProfileSource: ProfileSource = NOOP_PROFILE_SOURCE;

/**
 * Install the embedder's ProfileSource. Calling more than once
 * replaces the previous installation; not calling at all leaves the
 * engine on its noop default.
 */
export function setProfileSource(source: ProfileSource): void {
    activeProfileSource = source;
}

export function getProfileSource(): ProfileSource {
    return activeProfileSource;
}

// ============================================================================
// CustomRulesSource
// ============================================================================

/**
 * Subset of the server's `CustomRuleDTO` that the engine's custom-rule
 * executor consumes. Kept narrow so embedders that don't run the
 * server's full custom-rules pipeline (e.g. the CLI) can still
 * implement the interface trivially.
 */
export interface EngineCustomRule {
    ruleId: string;
    name: string;
    expression: string;
    severity: 'error' | 'warning' | 'information';
    validationMessage?: string | null;
    category?: string | null;
}

/**
 * Optional source of user-defined business rules. The engine queries
 * it once per resource validation; default returns no rules.
 */
export interface CustomRulesSource {
    getRulesByResourceType(resourceType: string): Promise<EngineCustomRule[]>;
}

const NOOP_CUSTOM_RULES_SOURCE: CustomRulesSource = {
    async getRulesByResourceType() {
        return [];
    },
};

let activeCustomRulesSource: CustomRulesSource = NOOP_CUSTOM_RULES_SOURCE;

export function setCustomRulesSource(source: CustomRulesSource): void {
    activeCustomRulesSource = source;
}

export function getCustomRulesSource(): CustomRulesSource {
    return activeCustomRulesSource;
}
