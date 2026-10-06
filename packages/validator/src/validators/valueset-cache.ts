import { parseDefinitionCacheKey } from './valueset-package-utils.js';
import { RegisteredTerminologyResources } from './registered-terminology-resources.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
/**
 * ValueSet Cache
 * 
 * Centralized caching layer for ValueSet and CodeSystem resolution.
 * Extracted from valueset-validator.ts for modularity.
 */

import { TerminologySourceContexts } from './terminology-source-context.js';
import { canonicalPinCacheKey } from '../package/canonical-pin-scope.js';
import type { ValueSet, CodeSystem } from './valueset-types.js';
import { logger } from '../logger.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { captureValidationDependencyCacheHit } from '../validation-dependency-snapshot.js';

// ============================================================================
// Cache Types
// ============================================================================

export interface ServerExpansionEntry {
    codes: Set<string>;
    timestamp: number;
}

// ============================================================================
// ValueSet Cache
// ============================================================================

export class ValueSetCache {
    readonly sourceContexts = new TerminologySourceContexts();
    private expansionKey: ((url: string) => string) | undefined;

    setExpansionKeyResolver(resolve: (url: string) => string): void { this.expansionKey = resolve; }

    getExpandedCodesForMembership(url: string): Set<string> | undefined {
        const scoped = this.getExpandedCodes(this.expansionKey ? this.expansionKey(url) : url);
        return scoped ?? (this.sourceContexts.permitsPlainCache() ? this.getExpandedCodes(url) : undefined);
    }

    contextKey(key: string): string { return canonicalPinCacheKey(this.sourceContexts.key(key)); }
    private readonly registeredResources: RegisteredTerminologyResources;

    registerResource(type: 'ValueSet' | 'CodeSystem', url: string, version: string | undefined,
        fhirVersion: FhirVersion, resource: ValueSet | CodeSystem): void {
        this.registeredResources.register(type, url, version, fhirVersion, resource);
        this.sourceContexts.advanceResolutionRevision();
    }

    private registered(type: 'ValueSet' | 'CodeSystem', key: string): ValueSet | CodeSystem | undefined {
        return this.registeredResources.get(type, key, this.sourceContexts.context()?.fhirVersion);
    }

    private read<T>(cache: BoundedLruCache<string, T>, key: string, domain: string): T | undefined {
        const scopedKey = this.contextKey(key);
        return captureValidationDependencyCacheHit(domain, scopedKey, () => {
            const scoped = cache.get(scopedKey);
            return scoped === undefined && this.sourceContexts.permitsPlainCache()
                ? cache.get(canonicalPinCacheKey(this.plainKey(key))) : scoped;
        });
    }

    private has<T>(cache: BoundedLruCache<string, T>, key: string): boolean {
        return cache.has(this.contextKey(key)) || (this.sourceContexts.permitsPlainCache()
            && cache.has(canonicalPinCacheKey(this.plainKey(key))));
    }

    private plainKey(key: string): string {
        const selection = parseDefinitionCacheKey(key);
        if (!selection) return key;
        const suffix = selection.requestedVersion ?? selection.fhirVersion;
        return suffix ? `${selection.canonical}|${suffix}` : selection.canonical;
    }

    private valueSetCache: BoundedLruCache<string, Set<string>>;
    private codeSystemCache: BoundedLruCache<string, CodeSystem>;
    private valueSetFileCache: BoundedLruCache<string, ValueSet | null>;
    private codeSystemFileCache: BoundedLruCache<string, CodeSystem | null>;
    private serverExpansionCache: BoundedLruCache<string, ServerExpansionEntry>;

    constructor(maxEntriesPerDomain: number = 5_000) {
        this.registeredResources = new RegisteredTerminologyResources(maxEntriesPerDomain);
        this.valueSetCache = new BoundedLruCache(maxEntriesPerDomain);
        this.codeSystemCache = new BoundedLruCache(maxEntriesPerDomain);
        this.valueSetFileCache = new BoundedLruCache(maxEntriesPerDomain);
        this.codeSystemFileCache = new BoundedLruCache(maxEntriesPerDomain);
        this.serverExpansionCache = new BoundedLruCache(maxEntriesPerDomain);
    }

    // -------------------------------------------------------------------------
    // ValueSet Code Cache (expanded codes)
    // -------------------------------------------------------------------------

    hasExpandedCodes(valueSetUrl: string): boolean {
        return this.has(this.valueSetCache, valueSetUrl);
    }

    getExpandedCodes(valueSetUrl: string): Set<string> | undefined {
        return this.read(this.valueSetCache, valueSetUrl, 'expanded-codes');
    }

    setExpandedCodes(valueSetUrl: string, codes: Set<string>): void {
        valueSetUrl = this.contextKey(valueSetUrl);
        this.valueSetCache.set(valueSetUrl, codes);
    }

    // -------------------------------------------------------------------------
    // ValueSet File Cache (raw ValueSet resources)
    // -------------------------------------------------------------------------

    hasValueSetFile(url: string): boolean {
        if (this.registered('ValueSet', url)) return true;
        return this.has(this.valueSetFileCache, url);
    }

    getValueSetFile(url: string): ValueSet | null | undefined {
        const registered = this.registered('ValueSet', url) as ValueSet | undefined;
        if (registered) return captureValidationDependencyCacheHit('valueset-file', this.contextKey(url), () => registered);
        return this.read(this.valueSetFileCache, url, 'valueset-file');
    }

    setValueSetFile(url: string, valueSet: ValueSet | null): void {
        url = this.contextKey(url);
        this.valueSetFileCache.set(url, valueSet);
    }

    // -------------------------------------------------------------------------
    // CodeSystem Cache
    // -------------------------------------------------------------------------

    hasCodeSystem(systemUrl: string): boolean {
        if (this.registered('CodeSystem', systemUrl)) return true;
        return this.has(this.codeSystemCache, systemUrl);
    }

    getCodeSystem(systemUrl: string): CodeSystem | undefined {
        const registered = this.registered('CodeSystem', systemUrl) as CodeSystem | undefined;
        if (registered) return captureValidationDependencyCacheHit('codesystem', this.contextKey(systemUrl), () => registered);
        return this.read(this.codeSystemCache, systemUrl, 'codesystem');
    }

    setCodeSystem(systemUrl: string, codeSystem: CodeSystem): void {
        systemUrl = this.contextKey(systemUrl);
        this.codeSystemCache.set(systemUrl, codeSystem);
    }

    hasCodeSystemFile(url: string): boolean {
        if (this.registered('CodeSystem', url)) return true;
        return this.has(this.codeSystemFileCache, url);
    }

    getCodeSystemFile(url: string): CodeSystem | null | undefined {
        const registered = this.registered('CodeSystem', url) as CodeSystem | undefined;
        if (registered) return captureValidationDependencyCacheHit('codesystem-file', this.contextKey(url), () => registered);
        return this.read(this.codeSystemFileCache, url, 'codesystem-file');
    }

    setCodeSystemFile(url: string, codeSystem: CodeSystem | null): void {
        url = this.contextKey(url);
        this.codeSystemFileCache.set(url, codeSystem);
    }

    // -------------------------------------------------------------------------
    // Server Expansion Cache (TTL-based)
    // -------------------------------------------------------------------------

    getServerExpansion(cacheKey: string, ttlSeconds: number): Set<string> | null {
        cacheKey = this.contextKey(cacheKey);
        const cached = this.serverExpansionCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < ttlSeconds * 1000) {
            return cached.codes;
        }
        if (cached) this.serverExpansionCache.delete(cacheKey);
        return null;
    }

    setServerExpansion(cacheKey: string, codes: Set<string>): void {
        cacheKey = this.contextKey(cacheKey);
        this.serverExpansionCache.set(cacheKey, {
            codes,
            timestamp: Date.now()
        });
    }

    // -------------------------------------------------------------------------
    // Cache Management
    // -------------------------------------------------------------------------

    /**
     * Drop recorded misses and empty expansions. Positive entries stay valid
     * when a further store becomes reachable; misses do not, because that
     * store may answer them.
     */
    clearNegativeEntries(): void {
        for (const key of [...this.valueSetFileCache.keys()]) {
            if (this.valueSetFileCache.get(key) === null) this.valueSetFileCache.delete(key);
        }
        for (const key of [...this.codeSystemFileCache.keys()]) {
            if (this.codeSystemFileCache.get(key) === null) this.codeSystemFileCache.delete(key);
        }
        for (const key of [...this.valueSetCache.keys()]) {
            if (this.valueSetCache.get(key)?.size === 0) this.valueSetCache.delete(key);
        }
    }

    clear(): void {
        this.sourceContexts.advanceResolutionRevision();
        this.registeredResources.clear();
        this.valueSetCache.clear();
        this.codeSystemCache.clear();
        this.valueSetFileCache.clear();
        this.codeSystemFileCache.clear();
        this.serverExpansionCache.clear();
        logger.debug('[ValueSetCache] All caches cleared');
    }

    getStats(): {
        valueSetCount: number;
        codeSystemCount: number;
        fileCount: number;
        serverExpansionCount: number;
    } {
        const registered = this.registeredResources.getStats();
        return {
            valueSetCount: this.valueSetCache.size,
            codeSystemCount: this.codeSystemCache.size + registered.codeSystems,
            fileCount: this.valueSetFileCache.size + this.codeSystemFileCache.size + registered.valueSets + registered.codeSystems,
            serverExpansionCount: this.serverExpansionCache.size,
        };
    }
}
