/**
 * ValueSet Package Loader
 * 
 * Loads ValueSet and CodeSystem resources from local FHIR packages.
 * Extracted from valueset-validator.ts for modularity.
 */

import * as path from 'path';
import * as os from 'os';
import type {
    ValueSet,
    CodeSystem,
    ValueSetComposeInclude,
    ValueSetComposeExclude,
} from './valueset-types';
import { ValueSetCache, valueSetCache } from './valueset-cache';
import { logger } from '../logger';
import { applyConceptFilter, extractCodesFromCodeSystem } from './valueset-concept-utils';
import {
    type FhirVersion,
    preferredMajorFor,
    versionedCacheKey,
} from './valueset-package-utils';
import {
    findResourceByCanonicalScan,
    findResourceInPackages,
} from './valueset-package-search';

export interface ValueSetConceptFilter {
    system: string;
    property: string;
    op: string;
    value: string;
    version?: string;
}

// ============================================================================
// Package Loader
// ============================================================================

export class ValueSetPackageLoader {
    private packageDirectories: string[];

    constructor(private cache: ValueSetCache = valueSetCache) {
        this.packageDirectories = this.computePackageDirectories();
    }

    /**
     * Determine package directories to search for ValueSet resources
     */
    private computePackageDirectories(): string[] {
        const directories: string[] = [];

        // Primary cache (allows override via env)
        const envPath = process.env.FHIR_PACKAGE_CACHE_PATH;
        if (envPath) {
            directories.push(path.resolve(envPath));
        } else {
            directories.push(path.join(os.homedir(), '.fhir', 'packages'));
        }

        // Bundled packages shipped with the application
        directories.push(path.join(process.cwd(), 'server', 'data', 'fhir-packages'));

        // Bundled profiles (FHIR R4 Core, IGs, etc.)
        directories.push(path.join(process.cwd(), 'server', 'storage', 'profiles', 'bundled'));

        // Deduplicate while preserving order
        return Array.from(new Set(directories));
    }

    /**
     * Get package directories (for testing)
     */
    getPackageDirectories(): string[] {
        return [...this.packageDirectories];
    }

    /**
     * Scan all package directories for a FHIR resource matching the given
     * canonical URL. When `preferredFhirMajor` is set, prefer packages whose
     * directory name contains the FHIR version (e.g. "r5"). When
     * `requestedVersion` is set, an exact match on `resource.version` wins
     * immediately.
     */
    private async findInPackages<T extends { url?: string; version?: string }>(
        canonical: string,
        candidateFiles: string[],
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<T | null> {
        return findResourceInPackages(
            this.packageDirectories,
            canonical,
            candidateFiles,
            preferredFhirMajor,
            requestedVersion,
        );
    }

    private async findByCanonicalScan<T extends { url?: string; version?: string }>(
        canonical: string,
        filePrefix: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<T | null> {
        return findResourceByCanonicalScan(
            this.packageDirectories,
            canonical,
            filePrefix,
            preferredFhirMajor,
            requestedVersion,
        );
    }

    /**
     * Attempt to load a ValueSet definition from local packages and return its codes
     */
    async loadValueSet(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<string[] | null> {
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
        const bestMatch = await this.findInPackages<ValueSet>(
            canonical,
            [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
            preferredMajor,
            requestedVersion,
        ) ?? await this.findByCanonicalScan<ValueSet>(
            canonical,
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
    }

    /**
     * Return include filters from a ValueSet definition. This lets callers
     * distinguish a complete local expansion from a partial one where a
     * CodeSystem filter needs terminology-server evaluation.
     */
    async getIncludeConceptFilters(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSetConceptFilter[]> {
        const valueSet = await this.loadValueSetResource(valueSetUrl, fhirVersion);
        if (!valueSet) return [];

        return this.collectIncludeConceptFilters(valueSet, new Set(), 0, preferredMajorFor(fhirVersion));
    }

    /**
     * Load a CodeSystem from local packages by its canonical URL
     */
    async loadCodeSystem(
        systemUrl: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystem | null> {
        const cacheKey = requestedVersion
            ? `${systemUrl}|${requestedVersion}`
            : preferredFhirMajor
                ? `${systemUrl}|fhir${preferredFhirMajor}`
                : systemUrl;
        if (this.cache.hasCodeSystemFile(cacheKey)) {
            return this.cache.getCodeSystemFile(cacheKey) || null;
        }
        const canonical = systemUrl.split('|')[0];
        const lastSegment = canonical.split('/').pop();
        if (!lastSegment) { this.cache.setCodeSystemFile(cacheKey, null); return null; }
        const bestMatch = await this.findInPackages<CodeSystem>(
            canonical,
            [`CodeSystem-${lastSegment}.json`, `${lastSegment}.json`],
            preferredFhirMajor,
            requestedVersion,
        ) ?? await this.findByCanonicalScan<CodeSystem>(
            canonical,
            'CodeSystem',
            preferredFhirMajor,
            requestedVersion,
        );
        if (bestMatch) {
            this.cache.setCodeSystemFile(cacheKey, bestMatch);
            this.cache.setCodeSystem(cacheKey, bestMatch);
            return bestMatch;
        }
        this.cache.setCodeSystemFile(cacheKey, null);
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
        const codes = await this.collectCodesFromValueSet(valueSet, visited, 0, vsMajor);
        logger.debug(
            `[ValueSetPackageLoader] extractCodesFromValueSet returning ${codes.length} codes`,
        );
        return codes;
    }

    /**
     * Hard ceiling on `compose.include.valueSet` recursion depth. Real
     * ValueSet composition trees never exceed a handful of levels; anything
     * beyond this limit is almost certainly a configuration error.
     */
    private static readonly MAX_COMPOSITION_DEPTH = 20;

    /**
     * Internal: recursive collector used by `extractCodesFromValueSet`.
     *
     * Returns a deduplicated array containing both the prefixed (`system|code`)
     * and bare (`code`) form of every matching code, mirroring the behaviour
     * of the caller.
     */
    private async collectCodesFromValueSet(
        valueSet: ValueSet,
        visited: Set<string>,
        depth: number,
        preferredFhirMajor?: string,
    ): Promise<string[]> {
        if (depth >= ValueSetPackageLoader.MAX_COMPOSITION_DEPTH) {
            logger.warn(
                `[ValueSetPackageLoader] Composition depth limit ` +
                `(${ValueSetPackageLoader.MAX_COMPOSITION_DEPTH}) reached at ` +
                `${valueSet.url ?? '<anonymous>'} — stopping recursion`,
            );
            return [];
        }
        if (valueSet.url && visited.has(valueSet.url)) {
            logger.warn(
                `[ValueSetPackageLoader] Cycle detected at ${valueSet.url} — skipping`,
            );
            return [];
        }
        if (valueSet.url) visited.add(valueSet.url);

        const accumulator = new Set<string>();

        // 1. Pre-expanded expansion (flat + nested)
        if (valueSet.expansion?.contains) {
            const flatten = (
                entries: Array<{ system?: string; code?: string; contains?: any[] }>,
            ): void => {
                for (const entry of entries) {
                    if (entry.code) {
                        if (entry.system) {
                            accumulator.add(`${entry.system}|${entry.code}`);
                        }
                        accumulator.add(entry.code);
                    }
                    if (Array.isArray(entry.contains) && entry.contains.length > 0) {
                        flatten(entry.contains);
                    }
                }
            };
            flatten(valueSet.expansion.contains);
        }

        // 2. compose.include
        if (valueSet.compose?.include) {
            for (const include of valueSet.compose.include) {
                const included = await this.resolveIncludeOrExclude(
                    include,
                    visited,
                    depth,
                    preferredFhirMajor,
                );
                included.forEach(code => accumulator.add(code));
            }
        }

        // 3. compose.exclude — remove matching codes from the accumulator
        if (valueSet.compose?.exclude) {
            for (const exclude of valueSet.compose.exclude) {
                const excluded = await this.resolveIncludeOrExclude(
                    exclude,
                    visited,
                    depth,
                    preferredFhirMajor,
                );
                excluded.forEach(code => accumulator.delete(code));
            }
        }

        return Array.from(accumulator);
    }

    /**
     * Resolve a `compose.include` / `compose.exclude` entry to a set of
     * `system|code` + `code` strings.
     */
    private async resolveIncludeOrExclude(
        entry: ValueSetComposeInclude | ValueSetComposeExclude,
        visited: Set<string>,
        depth: number,
        preferredFhirMajor?: string,
    ): Promise<string[]> {
        const codes: string[] = [];
        const system = entry.system;

        // 3a. Explicit concepts
        if (entry.concept && entry.concept.length > 0) {
            for (const concept of entry.concept) {
                if (!concept.code) continue;
                if (system) codes.push(`${system}|${concept.code}`);
                codes.push(concept.code);
            }
        }

        // 3b. Referenced ValueSets (recursive composition)
        if (entry.valueSet && entry.valueSet.length > 0) {
            for (const vsUrl of entry.valueSet) {
                const nestedRaw = await this.loadValueSetResource(vsUrl);
                if (nestedRaw) {
                    const nestedCodes = await this.collectCodesFromValueSet(
                        nestedRaw,
                        visited,
                        depth + 1,
                        preferredFhirMajor,
                    );
                    codes.push(...nestedCodes);
                }
            }
        }

        // 3c. System without explicit concepts and without filters →
        //     include every code from the system
        const hasConcepts = entry.concept && entry.concept.length > 0;
        const hasFilters =
            'filter' in entry && Array.isArray(entry.filter) && entry.filter.length > 0;
        const hasValueSets = entry.valueSet && entry.valueSet.length > 0;

        if (system && !hasConcepts && !hasFilters && !hasValueSets) {
            const codeSystem = await this.loadCodeSystem(system, preferredFhirMajor, entry.version);
            if (codeSystem) {
                const csCodes = this.extractCodesFromCodeSystem(codeSystem);
                for (const code of csCodes) {
                    codes.push(`${system}|${code}`);
                    codes.push(code);
                }
            } else {
                logger.warn(
                    `[ValueSetPackageLoader] CodeSystem not found for ${system}`,
                );
            }
        }

        // 3d. System + filter → apply the filter to the CodeSystem's concept
        //     tree. Supports the two most common filter operations:
        //       - `concept is-a <code>`  : include the code and all descendants
        //       - `concept = <code>`     : include just the code
        if (system && hasFilters) {
            const codeSystem = await this.loadCodeSystem(system, preferredFhirMajor, entry.version);
            if (codeSystem) {
                for (const filter of (entry as ValueSetComposeInclude).filter ?? []) {
                    const filtered = applyConceptFilter(codeSystem, filter);
                    for (const code of filtered) {
                        codes.push(`${system}|${code}`);
                        codes.push(code);
                    }
                }
            }
        }

        return codes;
    }

    /**
     * Load a ValueSet resource (not just its codes) for use in recursive
     * composition. Uses the same package search path as `loadValueSet`.
     */
    private async loadValueSetResource(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSet | null> {
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
        const result = await this.findInPackages<ValueSet>(
            canonical,
            [`ValueSet-${lastSegment}.json`, `${lastSegment}.json`],
            preferredMajor,
            requestedVersion,
        ) ?? await this.findByCanonicalScan<ValueSet>(
            canonical,
            'ValueSet',
            preferredMajor,
            requestedVersion,
        );
        this.cache.setValueSetFile(cacheKey, result ?? null);
        return result;
    }

    private async collectIncludeConceptFilters(
        valueSet: ValueSet,
        visited: Set<string>,
        depth: number,
        preferredFhirMajor?: string,
    ): Promise<ValueSetConceptFilter[]> {
        if (depth >= ValueSetPackageLoader.MAX_COMPOSITION_DEPTH) return [];
        if (valueSet.url && visited.has(valueSet.url)) return [];
        if (valueSet.url) visited.add(valueSet.url);

        const filters: ValueSetConceptFilter[] = [];
        for (const include of valueSet.compose?.include ?? []) {
            if (include.system && Array.isArray(include.filter)) {
                for (const filter of include.filter) {
                    filters.push({
                        system: include.system,
                        version: include.version,
                        property: filter.property,
                        op: filter.op,
                        value: filter.value,
                    });
                }
            }

            for (const nestedUrl of include.valueSet ?? []) {
                const nested = await this.loadValueSetResource(
                    nestedUrl,
                    preferredFhirMajor === '4' ? 'R4' : preferredFhirMajor === '5' ? 'R5' : preferredFhirMajor === '6' ? 'R6' : undefined,
                );
                if (nested) {
                    filters.push(...await this.collectIncludeConceptFilters(nested, visited, depth + 1, preferredFhirMajor));
                }
            }
        }

        return filters;
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
