import { promises as fs } from 'fs';
import { logger } from '../logger.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { scanCacheDirectory } from './sd-loader-package-scanner.js';

export async function scanProfileSources(params: {
  packageSources: string[];
  availableProfiles: Set<string>;
  packageVersionPins: Record<string, string>;
}): Promise<number> {
  const { packageSources, availableProfiles, packageVersionPins } = params;
  let sourcesFound = 0;

  for (const source of packageSources) {
    try {
      await fs.access(source);
      logger.info('[SDLoader] Scanning package source', sensitiveValueMetadata(source));
      await scanCacheDirectory(source, availableProfiles, { packageVersionPins });
      sourcesFound++;
    } catch (error) {
      logger.debug('[SDLoader] Package source unavailable', {
        ...sensitiveValueMetadata(source),
        ...validationFailureMetadata(error),
      });
    }
  }

  if (sourcesFound === 0) {
    logger.warn('[SDLoader] No package sources found! Validator will have limited functionality.');
  }

  return sourcesFound;
}
