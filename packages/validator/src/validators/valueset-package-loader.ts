import { captureValidationDependency } from '../validation-dependency-snapshot.js';
/**
 * ValueSet Package Loader
 * 
 * Loads ValueSet and CodeSystem resources from local FHIR packages.
 * Extracted from valueset-validator.ts for modularity.
 */
import type {
    ValueSet,
    CodeSystem,
} from './valueset-types.js';
import { ValueSetCache } from './valueset-cache.js';
import { logger } from '../logger.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import { extractCodesFromCodeSystem } from './valueset-concept-utils.js';
import {
    type FhirVersion,
    preferredMajorFor,
    versionedCacheKey,
} from './valueset-package-utils.js';
import { ValueSetPackageResourceAccess } from './valueset-package-resource-access.js';
import {
    collectCodesFromValueSet,
    collectIncludeConceptFilters,
    collectUnenumerableSystemIncludes,
    type ValueSetConceptFilter,
} from './valueset-package-expansion.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';

export type { ValueSetConceptFilter };

// ============================================================================
// Package Loader
// ============================================================================

export class ValueSetPackageLoader {
    private missingCodeSystemKeys = new Set<string>();
    private pendingCodeSystemLoads = new Map<string, Promise<CodeSystem | null>>();

    constructor(
        private cache: ValueSetCache = new ValueSetCache(),
        private readonly packageResources = new ValueSetPackageResourceAccess(),
    ) {}

    /**
     * Get package directories (for testing)
     */
    getPackageDirectories(): string[] {
        return this.packageResources.getPackageDirectories();
    }

    /** Clear loader-local negative/single-flight state after packages change. */
    clearLookupState(): void {
        this.packageResources.clear();
        this.missingCodeSystemKeys.clear();
        this.pendingCodeSystemLoads.clear();
    }

    /**
     * Bind package lookups to the host tenant scope. Misses recorded before
     * the scope was known may be answerable by the tenant's own packages, so
     * loader-local negative state is discarded when the tenant changes.
     */
    setSourceContext(context: ProfileSourceContext | undefined): boolean {
        const changed = this.packageResources.setSourceContext(context);
        if (changed) this.clearLookupState();
        return changed;
    }

    /** Whether lookups currently include the host tenant's installed packages. */
    hasHostPackageScope(): boolean {
        return this.packageResources.getSourceContext() !== undefined;
    }

    /**
     * Attempt to load a ValueSet definition from local packages and return its codes
     */
    async loadValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[] | null> {
        return captureValidationDependency('terminology', 'loadValueSet', [valueSetUrl, fhirVersion], async () => {
            const parts = valueSetUrl.split('|');
            const canonical = parts[0];
            const requestedVersion = parts[1];
            const cacheKey = versionedCacheKey(canonical, requestedVersion, fhirVersion);
            if (this.cache.hasValueSetFile(cacheKey)) {
                const cached = this.cache.getValueSetFile(cacheKey);
                return cached ? await this.extractCodesFromValueSet(cached) : null;
            }
            const lastSegment = canonical.split('/').pop();
            if (!lastSegment) { this.cache.setValueSetFile(cacheKey, null); return null; }
            const preferredMajor = requestedVersion ? requestedVersion.split('.')[0] : preferredMajorFor(fhirVersion);
            const bestMatch = await this.packageResources.findResource<ValueSet>(
                canonical,
                [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
                'ValueSet',
                preferredMajor,
                requestedVersion,
            );
            if (bestMatch) {
                this.cache.setValueSetFile(cacheKey, bestMatch);
                return await this.extractCodesFromValueSet(bestMatch);
            }
            this.cache.setValueSetFile(cacheKey, null);
            return null;
        });
    }

    /**
     * Return include filters from a ValueSet definition. This lets callers
     * distinguish a complete local expansion from a partial one where a
     * CodeSystem filter needs terminology-server evaluation.
     */
    async getIncludeConceptFilters(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSetConceptFilter[]> {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return [];

        return collectIncludeConceptFilters(valueSet, this, new Set(), 0, preferredMajorFor(fhirVersion));
    }

    /**
     * Return systems the ValueSet includes whole-system whose CodeSystem the
     * local package stores cannot enumerate (absent, wrong pinned version, or
     * non-complete content). The local expansion is provably incomplete for
     * those systems, so a membership miss against them is not authoritative.
     */
    async getUnenumerableSystemIncludes(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[]> {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return [];

        return collectUnenumerableSystemIncludes(valueSet, this, new Set(), 0, preferredMajorFor(fhirVersion));
    }

    /**
     * Load a CodeSystem from local packages by its canonical URL
     */
    async loadCodeSystem(
        systemUrl: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystem | null> {
        return captureValidationDependency('terminology', 'loadCodeSystem', [systemUrl, preferredFhirMajor, requestedVersion], async () => {
            const cacheKey = requestedVersion
                ? `${systemUrl}|${requestedVersion}`
                : preferredFhirMajor
                    ? `${systemUrl}|fhir${preferredFhirMajor}`
                    : systemUrl;
            if (this.cache.hasCodeSystemFile(cacheKey)) {
                const cached = this.cache.getCodeSystemFile(cacheKey);
                if (cached) return cached;
                // A null in the shared cache may predate this loader and a package
                // install. Only trust misses observed by this loader; cache resets
                // explicitly clear this local set.
                if (this.missingCodeSystemKeys.has(cacheKey)) return null;
            }
            const pending = this.pendingCodeSystemLoads.get(cacheKey);
            if (pending) return pending;

            const load = this.loadCodeSystemUncached(
                systemUrl,
                cacheKey,
                preferredFhirMajor,
                requestedVersion,
            );
            this.pendingCodeSystemLoads.set(cacheKey, load);
            try {
                return await load;
            } finally {
                this.pendingCodeSystemLoads.delete(cacheKey);
            }
        });
    }

    private async loadCodeSystemUncached(
        systemUrl: string,
        cacheKey: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystem | null> {
        const requestedCanonical = systemUrl.split('|')[0];
        const canonical = normalizeKnownCodeSystemCanonical(requestedCanonical);
        const lastSegment = canonical.split('/').pop();
        if (!lastSegment) {
            this.cache.setCodeSystemFile(cacheKey, null);
            this.missingCodeSystemKeys.add(cacheKey);
            return null;
        }
        const bestMatch = await this.packageResources.findResource<CodeSystem>(
            canonical,
            [`CodeSystem-${lastSegment}.json`, `${lastSegment}.json`],
            'CodeSystem',
            preferredFhirMajor,
            requestedVersion,
        );
        if (bestMatch) {
            this.missingCodeSystemKeys.delete(cacheKey);
            this.cache.setCodeSystemFile(cacheKey, bestMatch);
            this.cache.setCodeSystem(cacheKey, bestMatch);
            if (requestedVersion) {
                const versionedCanonicalKey = `${canonical}|${requestedVersion}`;
                this.cache.setCodeSystemFile(versionedCanonicalKey, bestMatch);
                this.cache.setCodeSystem(versionedCanonicalKey, bestMatch);
                return bestMatch;
            }
            this.cache.setCodeSystemFile(requestedCanonical, bestMatch);
            this.cache.setCodeSystem(requestedCanonical, bestMatch);
            this.cache.setCodeSystemFile(canonical, bestMatch);
            this.cache.setCodeSystem(canonical, bestMatch);
            return bestMatch;
        }
        this.cache.setCodeSystemFile(cacheKey, null);
        this.missingCodeSystemKeys.add(cacheKey);
        return null;
    }

    /**
     * Extract codes from a ValueSet resource (expansion or compose/include).
     *
     * Supports:
     * - Pre-expanded `expansion.contains` (including hierarchical `contains`)
     * - `compose.include` with explicit concepts
     * - `compose.include` referencing a CodeSystem (full system inclusion)
     * - `compose.include.valueSet` — recursive ValueSet composition
     * - `compose.include.filter` — basic `concept is-a <code>` + `=` filters
     * - `compose.exclude` — removes codes from the result set
     * - CodeSystem supplements (merges extra properties without contributing
     *   codes, which is the correct FHIR semantics)
     */
    async extractCodesFromValueSet(valueSet: ValueSet): Promise<string[]> {
        // Guard against recursive composition cycles AND unbounded depth.
        // Cycle detection via `visited` covers the A → B → A case, but a
        // deeply-nested non-cyclic tree (A → B → C → ... → Z) could still
        // blow the call stack on pathological inputs. `MAX_COMPOSITION_DEPTH`
        // puts an explicit ceiling on that — any real-world FHIR ValueSet
        // composition tree is under 10 levels deep.
        const visited = new Set<string>();
        // Derive preferred FHIR major version from the ValueSet's own version
        // (e.g. "5.0.0" → "5") so CodeSystem lookups prefer the correct package.
        const vsMajor = valueSet.version?.split('.')[0];
        const codes = await collectCodesFromValueSet(valueSet, this, visited, 0, vsMajor);
        logger.debug(
            `[ValueSetPackageLoader] extractCodesFromValueSet returning ${codes.length} codes`,
        );
        return codes;
    }

    /**
     * Load a ValueSet resource (not just its codes) for use in recursive
     * composition. Uses the same package search path as `loadValueSet`.
     */
    async loadValueSetResource(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSet | null> {
        return captureValidationDependency('terminology', 'loadValueSetResource', [valueSetUrl, fhirVersion], async () => {
            const [canonical, requestedVersion] = valueSetUrl.split('|');
            const cacheKey = versionedCacheKey(canonical, requestedVersion, fhirVersion);
            if (this.cache.hasValueSetFile(cacheKey)) {
                return this.cache.getValueSetFile(cacheKey) ?? null;
            }
            const lastSegment = canonical.split('/').pop();
            if (!lastSegment) {
                this.cache.setValueSetFile(cacheKey, null);
                return null;
            }
            const preferredMajor = requestedVersion ? requestedVersion.split('.')[0] : preferredMajorFor(fhirVersion);
            const result = await this.packageResources.findResource<ValueSet>(
                canonical,
                [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
                'ValueSet',
                preferredMajor,
                requestedVersion,
            );
            this.cache.setValueSetFile(cacheKey, result ?? null);
            return result;
        });
    }

    /**
     * Extract all codes from a CodeSystem (including nested concepts).
     *
     * Supplements are ignored here — per FHIR semantics, a supplement adds
     * properties/designations to another CodeSystem but does not contribute
     * new codes. The base CodeSystem should be loaded separately.
     */
    extractCodesFromCodeSystem(codeSystem: CodeSystem): string[] {
        return extractCodesFromCodeSystem(codeSystem);
    }
}
