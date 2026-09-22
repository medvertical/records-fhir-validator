import { logger } from '../logger.js';
import type { TerminologyResolutionConfig } from './valueset-types.js';
import { type FhirVersion } from './valueset-expansion-cache-key.js';
import { getScopedExpansionCacheKey } from './valueset-server-routing.js';
import { getKnownValueSetExpansion } from './valueset-known-expansions.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { TerminologyApiClient } from './terminology-api-client.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { canDelegateValueSetExpansion } from './valueset-delegation-policy.js';

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
  const canDelegate = canDelegateValueSetExpansion(resolutionConfig);

  try {
    if (strategy === 'server-first' && canDelegate) {
      const serverExpansion = await apiClient.expandValueSet(baseUrl);
      if (serverExpansion && serverExpansion.size > 0) {
        serverExpansion.forEach(code => expandedCodes.add(code));
        cache.setExpandedCodes(cacheKey, expandedCodes);
        logger.debug('[ValueSetValidator] Server-first expansion succeeded', {
          ...terminologyTargetMetadata(valueSetUrl),
          codeCount: expandedCodes.size,
        });
        return expandedCodes;
      }
      logger.debug(
        '[ValueSetValidator] Server-first expansion unavailable; falling back to local',
        terminologyTargetMetadata(valueSetUrl),
      );
    }

    // 1. Try known expansions
    const knownExpansion = getKnownValueSetExpansion(baseUrl, fhirVersion);
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
    if (strategy === 'local-first' && canDelegate) {
      const serverExpansion = await apiClient.expandValueSet(baseUrl);
      if (serverExpansion && serverExpansion.size > 0) {
        serverExpansion.forEach(code => expandedCodes.add(code));
        cache.setExpandedCodes(cacheKey, expandedCodes);
        logger.debug('[ValueSetValidator] Local-first server fallback succeeded', {
          ...terminologyTargetMetadata(valueSetUrl),
          codeCount: expandedCodes.size,
        });
        return expandedCodes;
      }
    }

    logger.debug('[ValueSetValidator] ValueSet not found', {
      ...terminologyTargetMetadata(valueSetUrl),
      strategy,
    });

  } catch (error: unknown) {
    logger.warn(
      '[ValueSetValidator] Failed to expand ValueSet',
      validationFailureMetadata(error),
    );
  }

  // Cache even if empty
  cache.setExpandedCodes(cacheKey, expandedCodes);
  return expandedCodes;
}
