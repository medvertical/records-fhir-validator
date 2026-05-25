import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import { scanPackageDirectory } from './sd-loader-package-scanner';

export async function loadIGPackageIntoAvailableProfiles(
  cachePath: string,
  availableProfiles: Set<string>,
  packageId: string,
  version?: string
): Promise<void> {
  try {
    logger.info(`[SDLoader] Loading IG package: ${packageId}@${version || 'latest'}`);

    const packagePath = path.join(cachePath, packageId);

    try {
      await fs.access(packagePath);
    } catch {
      logger.warn(`[SDLoader] Package not found: ${packageId}`);
      return;
    }

    await scanPackageDirectory(packagePath, availableProfiles);

    logger.info(`[SDLoader] Loaded IG package: ${packageId}`);
  } catch (error) {
    logger.error(`[SDLoader] Error loading IG package ${packageId}:`, error);
  }
}
