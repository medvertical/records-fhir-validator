import { resolveLocalTerminologyAuthority, type CodeSystemLookup } from './local-terminology-authority-selection.js';
import { providerLookupKey, scopedProviderSnapshot, type LocalTerminologyAuthority } from './built-in-terminology-provider.js';
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
    collectComposeSystems,
    collectUnenumerableSystemIncludes,
    type ValueSetConceptFilter,
} from './valueset-package-expansion.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import { isCodeSystemForRequestedRelease, majorFhirVersion } from './valueset-code-system-rules.js';

export type { ValueSetConceptFilter };

export class ValueSetPackageLoader {
    private missingCodeSystemKeys = new Map<string, boolean>();
    private pendingCodeSystemLoads = new Map<string, Promise<CodeSystemLookup>>();

    constructor(
        private cache: ValueSetCache = new ValueSetCache(),
        private readonly packageResources = new ValueSetPackageResourceAccess(),
    ) { this.packageResources.bindSourceContexts?.(cache.sourceContexts); }

    getPackageDirectories(): string[] {
        return this.packageResources.getPackageDirectories();
    }

    async loadCodeSystemForValueSet(valueSet: ValueSet | undefined, system: string,
        fhirVersion?: FhirVersion, requestedVersion?: string): Promise<CodeSystem | null> {
        return this.cache.sourceContexts.run(fhirVersion, async () =>
            this.loadCodeSystem(system, await this.preferredFhirMajor(fhirVersion, valueSet), requestedVersion));
    }

    async loadLocalTerminologyAuthority(system: string, fhirVersion?: FhirVersion,
        requestedVersion?: string, valueSet?: ValueSet): Promise<LocalTerminologyAuthority | null> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
            const preferredMajor = await this.preferredFhirMajor(fhirVersion, valueSet);
            return resolveLocalTerminologyAuthority(this.cache, system, fhirVersion, requestedVersion, preferredMajor,
                (canonical, version) => this.loadCodeSystemOutcome(canonical, preferredMajor, version));
        });
    }

    providerSnapshotForContext(authority: LocalTerminologyAuthority | null, fhirVersion?: FhirVersion) {
        return this.cache.sourceContexts.run(fhirVersion, () => scopedProviderSnapshot(authority, this.cache.contextKey(providerLookupKey)));
    }

    contextCacheKey(key: string): string { return this.cache.contextKey(key); }

    /** Clear loader-local negative/single-flight state after packages change. */
    clearLookupState(): void {
        this.packageResources.clear();
        this.missingCodeSystemKeys.clear();
        this.pendingCodeSystemLoads.clear();
    }

    /**
     * Bind defaults for subsequent requests; active asynchronous snapshots
     * keep their source. A changed selection discards loader-local misses.
     */
    setSourceContext(context: ProfileSourceContext | undefined): boolean {
        const changed = this.packageResources.setSourceContext(context);
        if (changed) this.clearLookupState();
        return changed;
    }

    /** Whether lookups currently include the host tenant's installed packages. */
    hasHostPackageScope(): boolean {
        return this.packageResources.getSourceContext()?.organizationId !== undefined;
    }

    private contextFhirVersion(fhirVersion?: FhirVersion): FhirVersion | undefined {
        return fhirVersion ?? this.packageResources.getSourceContext()?.fhirVersion;
    }

    private async preferredFhirMajor(fhirVersion?: FhirVersion, valueSet?: ValueSet): Promise<string | undefined> {
        const contextVersion = this.contextFhirVersion(fhirVersion);
        const sourceVersion = contextVersion ?? (valueSet
            ? (await this.packageResources.getPublicationContext(valueSet))?.fhirVersion
            : undefined);
        return preferredMajorFor(sourceVersion);
    }

    async loadValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[] | null> {
        return this.cache.sourceContexts.run(fhirVersion, () => captureValidationDependency('terminology', 'loadValueSet', [valueSetUrl, fhirVersion, this.cache.contextKey('')], async () => {
            const parts = valueSetUrl.split('|');
            const canonical = parts[0];
            const requestedVersion = parts[1];
            const cacheKey = versionedCacheKey(canonical, requestedVersion, this.contextFhirVersion(fhirVersion));
            if (this.cache.hasValueSetFile(cacheKey)) {
                const cached = this.cache.getValueSetFile(cacheKey);
                return cached ? await this.extractCodesFromValueSet(cached, fhirVersion) : null;
            }
            const lastSegment = canonical.split('/').pop();
            if (!lastSegment) { this.cache.setValueSetFile(cacheKey, null); return null; }
            const preferredMajor = await this.preferredFhirMajor(fhirVersion);
            const bestMatch = await this.packageResources.findResource<ValueSet>(
                canonical,
                [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
                'ValueSet',
                preferredMajor,
                requestedVersion,
            );
            if (bestMatch) {
                this.cache.setValueSetFile(cacheKey, bestMatch);
                return await this.extractCodesFromValueSet(bestMatch, fhirVersion);
            }
            this.cache.setValueSetFile(cacheKey, null);
            return null;
        }));
    }

    /**
     * Return include filters from a ValueSet definition. This lets callers
     * distinguish a complete local expansion from a partial one where a
     * CodeSystem filter needs terminology-server evaluation.
     */
    async getIncludeConceptFilters(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSetConceptFilter[]> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return [];

        return collectIncludeConceptFilters(valueSet, this, new Set(), 0, await this.preferredFhirMajor(fhirVersion, valueSet));
        });
    }

    /**
     * Return systems the ValueSet includes whole-system whose CodeSystem the
     * local package stores cannot enumerate (absent, wrong pinned version, or
     * non-complete content). The local expansion is provably incomplete for
     * those systems, so a membership miss against them is not authoritative.
     */
    async getUnenumerableSystemIncludes(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[]> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return [];

        return collectUnenumerableSystemIncludes(valueSet, this, new Set(), 0, await this.preferredFhirMajor(fhirVersion, valueSet));
        });
    }

    /**
     * Whether the ValueSet's stored expansion declares more codes than the
     * local stores can assemble, from the expansion and its compose together.
     * VSAC packages up to 0.11.0 stored only the first 1000 codes of a larger
     * expansion, so a miss against those proves nothing.
     */
    async hasIncompleteExpansion(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<boolean> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        const total = valueSet?.expansion?.total;
        if (!valueSet || typeof total !== 'number') return false;
        // Every code is listed twice, bare and system-qualified; count it once.
        const assembled = new Set((await this.extractCodesFromValueSet(valueSet, fhirVersion)).filter(code => code.includes('|')));
        return assembled.size < total;
        });
    }

    /**
     * Return the code systems the ValueSet's compose can draw codes from, or
     * null when the local packages cannot tell.
     */
    async getComposeSystems(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[] | null> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return null;

        const systems = await collectComposeSystems(valueSet, this, new Set(), 0, await this.preferredFhirMajor(fhirVersion, valueSet));
        return systems ? Array.from(systems) : null;
        });
    }

    async loadCodeSystem(
        systemUrl: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystem | null> {
        return (await this.loadCodeSystemOutcome(systemUrl, preferredFhirMajor, requestedVersion)).codeSystem;
    }

    /** Keeps failed definition selection distinct from a successful scoped miss. */
    async loadCodeSystemOutcome(systemUrl: string, preferredFhirMajor?: string, requestedVersion?: string): Promise<CodeSystemLookup> {
        return this.cache.sourceContexts.run(majorFhirVersion(preferredFhirMajor), () => captureValidationDependency('terminology', 'loadCodeSystem', [systemUrl, preferredFhirMajor, requestedVersion, this.cache.contextKey('')], async () => {
            const cacheKey = versionedCacheKey(systemUrl, requestedVersion,
                this.contextFhirVersion(majorFhirVersion(preferredFhirMajor)));
            if (this.cache.hasCodeSystemFile(cacheKey)) {
                const cached = this.cache.getCodeSystemFile(cacheKey);
                if (cached) return { codeSystem: cached, blocked: false };
                // A null in the shared cache may predate this loader and a package
                // install. Only trust misses observed by this loader; cache resets
                // explicitly clear this local set.
                const blocked = this.missingCodeSystemKeys.get(this.cache.contextKey(cacheKey));
                if (blocked !== undefined) return { codeSystem: null, blocked };
            }
            const pending = this.pendingCodeSystemLoads.get(this.cache.contextKey(cacheKey));
            if (pending) return pending;

            const load = this.loadCodeSystemUncached(
                systemUrl,
                cacheKey,
                preferredFhirMajor,
                requestedVersion,
            );
            this.pendingCodeSystemLoads.set(this.cache.contextKey(cacheKey), load);
            try {
                return await load;
            } finally {
                if (this.pendingCodeSystemLoads.get(this.cache.contextKey(cacheKey)) === load)
                    this.pendingCodeSystemLoads.delete(this.cache.contextKey(cacheKey));
            }
        }));
    }

    private async loadCodeSystemUncached(
        systemUrl: string,
        cacheKey: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystemLookup> {
        const requestedCanonical = systemUrl.split('|')[0];
        const canonical = normalizeKnownCodeSystemCanonical(requestedCanonical);
        const lastSegment = canonical.split('/').pop();
        if (!lastSegment) {
            this.cache.setCodeSystemFile(cacheKey, null);
            this.missingCodeSystemKeys.set(this.cache.contextKey(cacheKey), false);
            return { codeSystem: null, blocked: false };
        }
        const args: Parameters<ValueSetPackageResourceAccess['findResource']> = [
            canonical,
            [`CodeSystem-${lastSegment}.json`, `${lastSegment}.json`],
            'CodeSystem',
            preferredFhirMajor,
            requestedVersion,
        ];
        const outcome = this.packageResources.findResourceWithStatus
            ? await this.packageResources.findResourceWithStatus<CodeSystem>(...args)
            : { resource: await this.packageResources.findResource<CodeSystem>(...args), blocked: false };
        const found = outcome.resource;
        const bestMatch = found && isCodeSystemForRequestedRelease(canonical, found, preferredFhirMajor, requestedVersion)
            ? found
            : null;
        if (bestMatch) {
            this.missingCodeSystemKeys.delete(this.cache.contextKey(cacheKey));
            this.cache.setCodeSystemFile(cacheKey, bestMatch);
            this.cache.setCodeSystem(cacheKey, bestMatch);
            if (requestedVersion) {
                const versionedCanonicalKey = versionedCacheKey(canonical, requestedVersion, this.contextFhirVersion(majorFhirVersion(preferredFhirMajor)));
                this.cache.setCodeSystemFile(versionedCanonicalKey, bestMatch);
                this.cache.setCodeSystem(versionedCanonicalKey, bestMatch);
                return { codeSystem: bestMatch, blocked: false };
            }
            this.cache.setCodeSystemFile(requestedCanonical, bestMatch);
            this.cache.setCodeSystem(requestedCanonical, bestMatch);
            this.cache.setCodeSystemFile(canonical, bestMatch);
            this.cache.setCodeSystem(canonical, bestMatch);
            return { codeSystem: bestMatch, blocked: false };
        }
        this.cache.setCodeSystemFile(cacheKey, null);
        this.missingCodeSystemKeys.set(this.cache.contextKey(cacheKey), outcome.blocked || Boolean(found));
        return { codeSystem: null, blocked: outcome.blocked || Boolean(found) };
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
    async extractCodesFromValueSet(valueSet: ValueSet, fhirVersion?: FhirVersion): Promise<string[]> {
        return this.cache.sourceContexts.run(fhirVersion, async () => {
        // Recursion has both cycle and depth guards.
        const visited = new Set<string>();
        // Terminology business versions do not identify a FHIR publication.
        const codes = await collectCodesFromValueSet(valueSet, this, visited, 0, await this.preferredFhirMajor(fhirVersion, valueSet));
        logger.debug(
            `[ValueSetPackageLoader] extractCodesFromValueSet returning ${codes.length} codes`,
        );
        return codes;
        });
    }

    async loadValueSetResource(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSet | null> {
        return this.cache.sourceContexts.run(fhirVersion, () => captureValidationDependency('terminology', 'loadValueSetResource', [valueSetUrl, fhirVersion, this.cache.contextKey('')], async () => {
            const [canonical, requestedVersion] = valueSetUrl.split('|');
            const cacheKey = versionedCacheKey(canonical, requestedVersion, this.contextFhirVersion(fhirVersion));
            if (this.cache.hasValueSetFile(cacheKey)) {
                return this.cache.getValueSetFile(cacheKey) ?? null;
            }
            const lastSegment = canonical.split('/').pop();
            if (!lastSegment) {
                this.cache.setValueSetFile(cacheKey, null);
                return null;
            }
            const preferredMajor = await this.preferredFhirMajor(fhirVersion);
            const result = await this.packageResources.findResource<ValueSet>(
                canonical,
                [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
                'ValueSet',
                preferredMajor,
                requestedVersion,
            );
            this.cache.setValueSetFile(cacheKey, result ?? null);
            return result;
        }));
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
