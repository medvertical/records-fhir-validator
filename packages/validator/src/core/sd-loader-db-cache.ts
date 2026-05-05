/**
 * StructureDefinition Loader - Embedder-Provided Profile Source
 *
 * Forwards profile-by-URL lookups to whatever ProfileSource the embedder
 * installed via `setProfileSource()`. Default = noop (returns null), so
 * the engine works fine in standalone (CLI / npm-package) contexts where
 * no database-backed source is available.
 *
 * Historically this file lazy-imported the server's `ProfileCache`
 * directly; that coupling now lives at `persistence/index.ts` where
 * embedders inject their implementation.
 */

import type { StructureDefinition } from './structure-definition-types';
import { logger } from '../logger';
import { getProfileSource } from '../persistence';

/**
 * Look up a profile in the embedder-provided ProfileSource.
 * @param url - Profile canonical URL
 * @param dbCacheNotFound - Negative cache set
 * @param fhirVersion - FHIR version to filter by (prevents R5 defs being returned for R4 validation)
 */
export async function checkDatabaseCache(
  url: string,
  dbCacheNotFound: Set<string>,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
): Promise<StructureDefinition | null> {
  // Create a version-specific cache key for negative cache
  const cacheKey = `${url}:${fhirVersion}`;

  // Skip lookup if we already know it's not there (negative cache)
  if (dbCacheNotFound.has(cacheKey)) {
    logger.debug(`[SDLoader] Skipping ProfileSource check for ${cacheKey} (known not found)`);
    return null;
  }

  const source = getProfileSource();
  if (!source.findByUrl) {
    return null;
  }

  logger.debug(`[SDLoader] Checking ProfileSource for: ${url} (${fhirVersion})`);
  try {
    const sd = await source.findByUrl(url, fhirVersion);
    if (sd) {
      logger.debug(`[SDLoader] ✅ Found in ProfileSource: ${url}`);
      return sd;
    }

    logger.debug(`[SDLoader] Not found in ProfileSource`);
    dbCacheNotFound.add(cacheKey);
    return null;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.debug(`[SDLoader] ProfileSource lookup failed:`, err.message);
    // Don't negative-cache errors — might be transient.
    return null;
  }
}

