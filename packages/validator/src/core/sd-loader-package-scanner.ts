/**
 * StructureDefinition Loader - Package Scan Orchestrator
 * 
 * Owns read-only index reuse and delegates filesystem walking to the focused
 * package source walker. Compatibility exports remain available here.
 */

import { logger } from '../logger.js';
import path from 'node:path';
import { loadFromPersistentIndex, type ProfileIndexWriter } from './sd-loader-persistent-index.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { walkPackageSource } from './sd-loader-package-source-walker.js';

export { compareVersions } from '../package-resolver/version-comparator.js';
export {
  parsePackageName,
  scanPackageDirectory,
} from './sd-loader-package-source-walker.js';

export interface ScanCacheDirectoryOptions {
  packageVersionPins?: Record<string, string>;
  indexWriter?: ProfileIndexWriter;
}

/**
 * Scan cache directory for available StructureDefinitions
 * Reuses valid indexes; persistence requires an explicit source-bound writer.
 */
export async function scanCacheDirectory(
  sourcePath: string,
  availableProfiles: Set<string>,
  options: ScanCacheDirectoryOptions = {}
): Promise<number> {
  if (options.indexWriter && options.indexWriter.sourcePath !== path.resolve(sourcePath)) {
    throw new Error('Profile index writer is bound to a different source');
  }
  try {
    const startTime = Date.now();
    const startProfileCount = availableProfiles.size;
    const packageVersionPins = options.packageVersionPins ?? {};
    const hasVersionPins = Object.keys(packageVersionPins).length > 0;
    const deduplicateEnabled = process.env.FHIR_DEDUPLICATE_PACKAGES !== 'false';

    // 1. Try to load from persistent index first
    if (!hasVersionPins) {
      const cachedProfiles = await loadFromPersistentIndex(sourcePath, { deduplicatePackages: deduplicateEnabled });
      if (cachedProfiles) {
        // Index is valid - use cached profiles
        for (const url of cachedProfiles) {
          availableProfiles.add(url);
        }
        const elapsed = Date.now() - startTime;
        const profilesAdded = availableProfiles.size - startProfileCount;
        logger.info(`[SDLoader] ⚡ Loaded ${profilesAdded} profiles from persistent index in ${elapsed}ms`);
        return cachedProfiles.size; // Return approximate package count
      }
    } else {
      logger.info(
        '[SDLoader] Skipping persistent index; package version pins are active',
        sensitiveValueMetadata(sourcePath),
      );
    }

    // 2. Index is invalid or missing - do full scan
    logger.info(`[SDLoader] Performing full package scan (index invalid or missing)...`);

    const walkResult = await walkPackageSource(sourcePath, availableProfiles, {
      packageVersionPins,
      deduplicateEnabled,
    });

    const elapsed = Date.now() - startTime;
    const profilesAdded = availableProfiles.size - startProfileCount;
    logger.info(
      `[SDLoader] ✓ Found ${profilesAdded} profiles from ${walkResult.scannedCount} packages in ${elapsed}ms`,
    );

    // Runtime scans stay read-only. Explicit builds may persist, but pins
    // change eligibility and must never replace the general source index.
    if (!hasVersionPins && options.indexWriter) {
      await options.indexWriter.save(
        walkResult.sourceProfiles,
        walkResult.packageDetails,
        { deduplicatePackages: deduplicateEnabled },
      );
    }

    return walkResult.scannedCount;

  } catch (error) {
    logger.warn(
      '[SDLoader] Package source scan failed',
      validationFailureMetadata(error),
    );
    if (options.indexWriter) throw error;
    return 0;
  }
}
