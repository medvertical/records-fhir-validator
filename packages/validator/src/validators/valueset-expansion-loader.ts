import { logger } from '../logger';
import type { TerminologyResolutionConfig } from './valueset-types';
import { type FhirVersion } from './valueset-expansion-cache-key';
import { getScopedExpansionCacheKey } from './valueset-server-routing';
import { KNOWN_VALUE_SET_EXPANSIONS } from './valueset-known-expansions';
import type { ValueSetCache } from './valueset-cache';
import type { TerminologyApiClient } from './terminology-api-client';
import type { ValueSetPackageLoader } from './valueset-package-loader';

/**
 * ValueSet → code-set expansion, extracted from valueset-validator.ts.
 *
 * Resolves a ValueSet URL to its set of `system|code` (and bare `code`)
 * strings following the configured strategy: server-first delegation, then
 * known built-in expansions, local IG packages, and (local-first) a server
 * fallback. Results — including empty ones — are cached under a scope-aware
 * key so routing/strategy changes do not serve stale expansions.
 */

export interface ExpansionDeps {
  cache: ValueSetCache;
  apiClient: TerminologyApiClient;
  packageLoader: ValueSetPackageLoader;
  resolutionConfig: TerminologyResolutionConfig;
}

export async function expandValueSet(
  deps: ExpansionDeps,
  valueSetUrl: string,
  fhirVersion?: FhirVersion,
): Promise<Set<string>> {
  const { cache, apiClient, packageLoader, resolutionConfig } = deps;

  // Check cache first
  const cacheKey = getScopedExpansionCacheKey(valueSetUrl, resolutionConfig, fhirVersion);
  const cached = cache.getExpandedCodes(cacheKey);
  if (cached) {
    return cached;
  }

  const baseUrl = valueSetUrl.split('|')[0];
  const expandedCodes = new Set<string>();
  const strategy = resolutionConfig.strategy;

  try {
    if (strategy === 'server-first') {
      const serverExpansion = await apiClient.expandValueSet(baseUrl);
      if (serverExpansion && serverExpansion.size > 0) {
        serverExpansion.forEach(code => expandedCodes.add(code));
        cache.setExpandedCodes(cacheKey, expandedCodes);
        logger.debug(`[ValueSetValidator] Server-First: Expanded ${valueSetUrl} with ${expandedCodes.size} codes from server`);
        return expandedCodes;
      }
      logger.debug(`[ValueSetValidator] Server-First: Server failed, falling back to local for ${valueSetUrl}`);
    }

    // 1. Try known expansions
    const knownExpansion = KNOWN_VALUE_SET_EXPANSIONS[baseUrl];
    if (knownExpansion) {
      knownExpansion.forEach(code => expandedCodes.add(code));
      cache.setExpandedCodes(cacheKey, expandedCodes);
      return expandedCodes;
    }

    // 2. Try local packages (pass full URL with version for version-aware loading)
    const packageExpansion = await packageLoader.loadValueSet(valueSetUrl, fhirVersion);
    if (packageExpansion && packageExpansion.length > 0) {
      packageExpansion.forEach(code => expandedCodes.add(code));
      cache.setExpandedCodes(cacheKey, expandedCodes);
      return expandedCodes;
    }

    // 3. Local-First only: Try server as fallback
    if (strategy === 'local-first') {
      const serverExpansion = await apiClient.expandValueSet(baseUrl);
      if (serverExpansion && serverExpansion.size > 0) {
        serverExpansion.forEach(code => expandedCodes.add(code));
        cache.setExpandedCodes(cacheKey, expandedCodes);
        logger.debug(`[ValueSetValidator] Local-First: Used server fallback for ${valueSetUrl}, got ${expandedCodes.size} codes`);
        return expandedCodes;
      }
    }

    logger.debug(`[ValueSetValidator] ValueSet ${valueSetUrl} not found (strategy: ${strategy})`);

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(`[ValueSetValidator] Failed to expand ${valueSetUrl}:`, err.message);
  }

  // Cache even if empty
  cache.setExpandedCodes(cacheKey, expandedCodes);
  return expandedCodes;
}
