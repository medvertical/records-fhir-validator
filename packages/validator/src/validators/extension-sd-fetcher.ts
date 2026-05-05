/**
 * Extension SD Fetcher
 * 
 * Fetches and caches Extension StructureDefinitions from remote registries.
 * This enables HAPI-level validation of extensions by loading their SDs.
 * 
 * Key Features:
 * - Fetch Extension SDs from packages.fhir.org
 * - Cache with configurable TTL
 * - Support for multiple registries
 * - Fallback behavior for unavailable SDs
 */

import type { StructureDefinition } from '../core/structure-definition-types';
import axios from 'axios';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface ExtensionSDCache {
    sd: StructureDefinition | null;
    fetchedAt: number;
    error?: string;
}

export interface FetcherConfig {
    /** Registry URLs to try */
    registries: string[];
    /** TTL for cached entries in ms */
    cacheTtlMs: number;
    /** Timeout for fetch requests */
    timeoutMs: number;
    /** Whether to fetch remote SDs */
    enableRemoteFetch: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: FetcherConfig = {
    registries: [
        'https://packages.fhir.org',
        'https://packages2.fhir.org'
    ],
    cacheTtlMs: 60 * 60 * 1000, // 1 hour
    timeoutMs: 5000,
    enableRemoteFetch: true
};

// ============================================================================
// Extension SD Fetcher
// ============================================================================

export class ExtensionSDFetcher {
    private cache = new Map<string, ExtensionSDCache>();
    private config: FetcherConfig;
    private inFlightRequests = new Map<string, Promise<StructureDefinition | null>>();

    constructor(config?: Partial<FetcherConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Fetch an extension StructureDefinition by URL
     */
    async fetch(extensionUrl: string): Promise<StructureDefinition | null> {
        // Check cache
        const cached = this.cache.get(extensionUrl);
        if (cached && Date.now() - cached.fetchedAt < this.config.cacheTtlMs) {
            logger.debug(`[ExtensionSDFetcher] Cache hit: ${extensionUrl}`);
            return cached.sd;
        }

        // Check if already fetching
        const inFlight = this.inFlightRequests.get(extensionUrl);
        if (inFlight) {
            logger.debug(`[ExtensionSDFetcher] Waiting for in-flight: ${extensionUrl}`);
            return inFlight;
        }

        // Skip remote fetch if disabled
        if (!this.config.enableRemoteFetch) {
            return null;
        }

        // Fetch from registries
        const fetchPromise = this.fetchFromRegistries(extensionUrl);
        this.inFlightRequests.set(extensionUrl, fetchPromise);

        try {
            const result = await fetchPromise;

            // Cache result
            this.cache.set(extensionUrl, {
                sd: result,
                fetchedAt: Date.now()
            });

            return result;
        } finally {
            this.inFlightRequests.delete(extensionUrl);
        }
    }

    /**
     * Try fetching from multiple registries
     */
    private async fetchFromRegistries(extensionUrl: string): Promise<StructureDefinition | null> {
        // Extract package info from extension URL
        const packageInfo = this.extractPackageInfo(extensionUrl);
        if (!packageInfo) {
            logger.debug(`[ExtensionSDFetcher] Cannot determine package for: ${extensionUrl}`);
            return null;
        }

        for (const registry of this.config.registries) {
            try {
                const sd = await this.fetchFromRegistry(registry, packageInfo, extensionUrl);
                if (sd) {
                    logger.debug(`[ExtensionSDFetcher] Found SD from ${registry}`);
                    return sd;
                }
            } catch (err) {
                logger.debug(`[ExtensionSDFetcher] Failed from ${registry}: ${err}`);
            }
        }

        logger.debug(`[ExtensionSDFetcher] Not found in any registry: ${extensionUrl}`);
        return null;
    }

    /**
     * Fetch from a specific registry
     */
    private async fetchFromRegistry(
        registryUrl: string,
        packageInfo: { package: string; version: string },
        extensionUrl: string
    ): Promise<StructureDefinition | null> {
        // Try direct URL resolution first (for hl7.org extensions)
        if (extensionUrl.startsWith('http://hl7.org/fhir/StructureDefinition/')) {
            const extensionName = extensionUrl.split('/').pop();
            const url = `${registryUrl}/hl7.fhir.r4.core/4.0.1/package/StructureDefinition-${extensionName}.json`;

            try {
                const response = await axios.get(url, { timeout: this.config.timeoutMs });
                if (response.data?.resourceType === 'StructureDefinition') {
                    return response.data as StructureDefinition;
                }
            } catch {
                // Try next method
            }
        }

        return null;
    }

    /**
     * Extract package info from extension URL
     */
    private extractPackageInfo(extensionUrl: string): { package: string; version: string } | null {
        // HL7 core extensions
        if (extensionUrl.startsWith('http://hl7.org/fhir/StructureDefinition/')) {
            return { package: 'hl7.fhir.r4.core', version: '4.0.1' };
        }

        // HL7 US Core
        if (extensionUrl.startsWith('http://hl7.org/fhir/us/core/StructureDefinition/')) {
            return { package: 'hl7.fhir.us.core', version: '6.1.0' };
        }

        // German Basisprofile
        if (extensionUrl.includes('kbv.de') || extensionUrl.includes('gematik.de')) {
            return { package: 'de.basisprofil.r4', version: '1.4.0' };
        }

        return null;
    }

    /**
     * Preload common extensions
     */
    async preloadCommon(): Promise<void> {
        const commonExtensions = [
            'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            'http://hl7.org/fhir/StructureDefinition/originalText',
            'http://hl7.org/fhir/StructureDefinition/translation'
        ];

        await Promise.all(commonExtensions.map(url => this.fetch(url)));
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get cache stats
     */
    getCacheStats(): { size: number; hitRate: number } {
        return {
            size: this.cache.size,
            hitRate: 0 // Would need to track hits/misses
        };
    }
}

// Singleton
export const extensionSDFetcher = new ExtensionSDFetcher();
