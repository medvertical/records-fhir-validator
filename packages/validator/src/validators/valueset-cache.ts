/**
 * ValueSet Cache
 * 
 * Centralized caching layer for ValueSet and CodeSystem resolution.
 * Extracted from valueset-validator.ts for modularity.
 */

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
    private valueSetCache: BoundedLruCache<string, Set<string>>;
    private codeSystemCache: BoundedLruCache<string, CodeSystem>;
    private valueSetFileCache: BoundedLruCache<string, ValueSet | null>;
    private codeSystemFileCache: BoundedLruCache<string, CodeSystem | null>;
    private serverExpansionCache: BoundedLruCache<string, ServerExpansionEntry>;

    constructor(maxEntriesPerDomain: number = 5_000) {
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
        return this.valueSetCache.has(valueSetUrl);
    }

    getExpandedCodes(valueSetUrl: string): Set<string> | undefined {
        return captureValidationDependencyCacheHit('expanded-codes', valueSetUrl, () => this.valueSetCache.get(valueSetUrl));
    }

    setExpandedCodes(valueSetUrl: string, codes: Set<string>): void {
        this.valueSetCache.set(valueSetUrl, codes);
    }

    // -------------------------------------------------------------------------
    // ValueSet File Cache (raw ValueSet resources)
    // -------------------------------------------------------------------------

    hasValueSetFile(url: string): boolean {
        return this.valueSetFileCache.has(url);
    }

    getValueSetFile(url: string): ValueSet | null | undefined {
        return captureValidationDependencyCacheHit('valueset-file', url, () => this.valueSetFileCache.get(url));
    }

    setValueSetFile(url: string, valueSet: ValueSet | null): void {
        this.valueSetFileCache.set(url, valueSet);
    }

    // -------------------------------------------------------------------------
    // CodeSystem Cache
    // -------------------------------------------------------------------------

    hasCodeSystem(systemUrl: string): boolean {
        return this.codeSystemCache.has(systemUrl);
    }

    getCodeSystem(systemUrl: string): CodeSystem | undefined {
        return captureValidationDependencyCacheHit('codesystem', systemUrl, () => this.codeSystemCache.get(systemUrl));
    }

    setCodeSystem(systemUrl: string, codeSystem: CodeSystem): void {
        this.codeSystemCache.set(systemUrl, codeSystem);
    }

    hasCodeSystemFile(url: string): boolean {
        return this.codeSystemFileCache.has(url);
    }

    getCodeSystemFile(url: string): CodeSystem | null | undefined {
        return captureValidationDependencyCacheHit('codesystem-file', url, () => this.codeSystemFileCache.get(url));
    }

    setCodeSystemFile(url: string, codeSystem: CodeSystem | null): void {
        this.codeSystemFileCache.set(url, codeSystem);
    }

    // -------------------------------------------------------------------------
    // Server Expansion Cache (TTL-based)
    // -------------------------------------------------------------------------

    getServerExpansion(cacheKey: string, ttlSeconds: number): Set<string> | null {
        const cached = this.serverExpansionCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < ttlSeconds * 1000) {
            return cached.codes;
        }
        if (cached) this.serverExpansionCache.delete(cacheKey);
        return null;
    }

    setServerExpansion(cacheKey: string, codes: Set<string>): void {
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
        return {
            valueSetCount: this.valueSetCache.size,
            codeSystemCount: this.codeSystemCache.size,
            fileCount: this.valueSetFileCache.size + this.codeSystemFileCache.size,
            serverExpansionCount: this.serverExpansionCache.size,
        };
    }
}
