/**
 * ValueSet Cache
 * 
 * Centralized caching layer for ValueSet and CodeSystem resolution.
 * Extracted from valueset-validator.ts for modularity.
 */

import type { ValueSet, CodeSystem } from './valueset-types';
import { logger } from '../logger';

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
    private valueSetCache: Map<string, Set<string>> = new Map();
    private codeSystemCache: Map<string, CodeSystem> = new Map();
    private valueSetFileCache: Map<string, ValueSet | null> = new Map();
    private codeSystemFileCache: Map<string, CodeSystem | null> = new Map();
    private serverExpansionCache: Map<string, ServerExpansionEntry> = new Map();

    // -------------------------------------------------------------------------
    // ValueSet Code Cache (expanded codes)
    // -------------------------------------------------------------------------

    hasExpandedCodes(valueSetUrl: string): boolean {
        return this.valueSetCache.has(valueSetUrl);
    }

    getExpandedCodes(valueSetUrl: string): Set<string> | undefined {
        return this.valueSetCache.get(valueSetUrl);
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
        return this.valueSetFileCache.get(url);
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
        return this.codeSystemCache.get(systemUrl);
    }

    setCodeSystem(systemUrl: string, codeSystem: CodeSystem): void {
        this.codeSystemCache.set(systemUrl, codeSystem);
    }

    hasCodeSystemFile(url: string): boolean {
        return this.codeSystemFileCache.has(url);
    }

    getCodeSystemFile(url: string): CodeSystem | null | undefined {
        return this.codeSystemFileCache.get(url);
    }

    setCodeSystemFile(url: string, codeSystem: CodeSystem | null): void {
        this.codeSystemFileCache.set(url, codeSystem);
    }

    // -------------------------------------------------------------------------
    // Server Expansion Cache (TTL-based)
    // -------------------------------------------------------------------------

    getServerExpansion(valueSetUrl: string, ttlSeconds: number): Set<string> | null {
        const cached = this.serverExpansionCache.get(valueSetUrl);
        if (cached && (Date.now() - cached.timestamp) < ttlSeconds * 1000) {
            return cached.codes;
        }
        return null;
    }

    setServerExpansion(valueSetUrl: string, codes: Set<string>): void {
        this.serverExpansionCache.set(valueSetUrl, {
            codes,
            timestamp: Date.now()
        });
    }

    // -------------------------------------------------------------------------
    // Cache Management
    // -------------------------------------------------------------------------

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

// Export singleton for shared cache
export const valueSetCache = new ValueSetCache();
