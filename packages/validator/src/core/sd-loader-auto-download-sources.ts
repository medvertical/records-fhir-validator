import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import type { AutoDownloadSourceContext } from './sd-loader-auto-download-source-context.js';
import { tryExternalProfileSource } from './sd-loader-external-profile-source.js';
import { tryPackageRegistrySource } from './sd-loader-package-registry-source.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { urlMatchesRequestedFhirVersion } from './sd-loader-version-utils.js';

export type { AutoDownloadSourceContext } from './sd-loader-auto-download-source-context.js';

export interface AutoDownloadAttemptResult {
  profile: StructureDefinition | null;
  cacheableMiss: boolean;
}

/** Try configured remote sources and classify the result for miss caching. */
export async function executeAutoDownload(
  url: string,
  context: AutoDownloadSourceContext,
): Promise<AutoDownloadAttemptResult> {
  const requestedFhirVersion = context.fhirVersion || 'R4';
  if (!urlMatchesRequestedFhirVersion(url, requestedFhirVersion)) {
    logger.info('[SDLoader] Skipping auto-download for FHIR-version-incompatible profile', {
      ...profileCanonicalMetadata(url),
      fhirVersion: requestedFhirVersion,
    });
    return { profile: null, cacheableMiss: true };
  }

  const config = normalizeProfileSourcesConfig(context.profileSourcesConfig);
  logger.info('[SDLoader] Profile not found locally, trying remote sources', profileCanonicalMetadata(url));
  logger.debug(`[SDLoader] Enabled sources: Simplifier=${config.simplifier}, Registry=${config.packageRegistry}`);

  try {
    if (config.simplifier) {
      const externalProfile = await tryExternalProfileSource(url, context, requestedFhirVersion);
      if (externalProfile) return { profile: externalProfile, cacheableMiss: false };
    }
    if (config.packageRegistry) {
      const packageProfile = await tryPackageRegistrySource(url, context, requestedFhirVersion);
      if (packageProfile) return { profile: packageProfile, cacheableMiss: false };
    }
    return { profile: null, cacheableMiss: true };
  } catch (error: unknown) {
    logger.warn(
      '[SDLoader] Auto-download source unavailable',
      validationFailureMetadata(error),
    );
    return { profile: null, cacheableMiss: false };
  }
}
