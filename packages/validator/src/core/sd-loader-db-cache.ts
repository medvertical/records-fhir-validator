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

import type { StructureDefinition } from './structure-definition-types.js';
import { logger } from '../logger.js';
import { getProfileSource, type ProfileSourceContext } from '../persistence/index.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

function matchesFhirVersion(sd: StructureDefinition, fhirVersion: 'R4' | 'R5' | 'R6'): boolean {
  const sdFhirVersion = (sd as { fhirVersion?: string }).fhirVersion;
  if (!sdFhirVersion) return true;

  const expectedPrefix = fhirVersion === 'R4' ? '4.' : fhirVersion === 'R5' ? '5.' : '6.';
  return sdFhirVersion.startsWith(expectedPrefix);
}

/**
 * Look up a profile in the embedder-provided ProfileSource.
 * @param url - Profile canonical URL
 * @param fhirVersion - FHIR version to filter by (prevents R5 defs being returned for R4 validation)
 */
export async function checkDatabaseCache(
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  context?: ProfileSourceContext,
): Promise<StructureDefinition | null> {
  const source = getProfileSource();
  if (!source.findByUrl) {
    return null;
  }

  logger.debug('[SDLoader] Checking ProfileSource', {
    ...profileCanonicalMetadata(url),
    fhirVersion,
  });
  try {
    const sd = await source.findByUrl(url, fhirVersion, context);
    if (sd) {
      if (!matchesFhirVersion(sd, fhirVersion)) {
        logger.debug('[SDLoader] ProfileSource result has wrong FHIR version', profileCanonicalMetadata(url));
        return null;
      }
      if (!profileMatchesCanonical(sd, url)) {
        logger.debug('[SDLoader] ProfileSource result has mismatched canonical', profileCanonicalMetadata(url));
        return null;
      }
      logger.debug('[SDLoader] Found in ProfileSource', profileCanonicalMetadata(url));
      return sd;
    }

    logger.debug(`[SDLoader] Not found in ProfileSource`);
    return null;
  } catch (error: unknown) {
    logger.debug(
      '[SDLoader] ProfileSource lookup failed',
      validationFailureMetadata(error),
    );
    // Don't negative-cache errors — might be transient.
    return null;
  }
}
