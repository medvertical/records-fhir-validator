import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import {
  isSafePackageId,
  isSafePackageVersion,
  packageErrorMetadata,
  packageReferenceMetadata,
} from '../package/package-artifact-policy.js';
import { PackageInstallationStore } from '../package/package-installation-store.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { scanPackageDirectory } from './sd-loader-package-scanner.js';

export interface LoadedIGPackage {
  packageId: string;
  version?: string;
  profiles: StructureDefinition[];
}

export async function loadIGPackageIntoAvailableProfiles(
  cachePath: string,
  availableProfiles: Set<string>,
  packageId: string,
  version?: string
): Promise<LoadedIGPackage | null> {
  const metadata = packageReferenceMetadata(packageId, version);
  if (!isSafePackageId(packageId) || (version !== undefined && !isSafePackageVersion(version))) {
    logger.warn('[SDLoader] Refusing to load an invalid IG package reference', metadata);
    return null;
  }

  try {
    logger.info('[SDLoader] Loading IG package', metadata);
    const installed = await new PackageInstallationStore(cachePath)
      .findInstalledPackage(packageId, version);
    const packagePath = installed
      ? path.join(installed.path, 'package')
      : await resolveLegacyPackagePath(cachePath, packageId, version);

    if (!packagePath) {
      logger.warn('[SDLoader] IG package is not installed', metadata);
      return null;
    }

    const profiles: StructureDefinition[] = [];
    await scanPackageDirectory(packagePath, availableProfiles, profile => profiles.push(profile));
    logger.info('[SDLoader] Loaded IG package', {
      ...packageReferenceMetadata(installed?.packageId ?? packageId, installed?.version ?? version),
      profiles: profiles.length,
    });
    return {
      packageId: installed?.packageId ?? packageId,
      version: installed?.version,
      profiles,
    };
  } catch (error: unknown) {
    logger.error('[SDLoader] Failed to load IG package', {
      ...metadata,
      ...packageErrorMetadata(error),
    });
    return null;
  }
}

async function resolveLegacyPackagePath(
  cachePath: string,
  packageId: string,
  version: string | undefined,
): Promise<string | null> {
  if (version !== undefined) return null;

  const cacheRoot = path.resolve(cachePath);
  const legacyRoot = path.resolve(cacheRoot, packageId);
  if (path.dirname(legacyRoot) !== cacheRoot) return null;

  for (const candidate of [path.join(legacyRoot, 'package'), legacyRoot]) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // Try the next supported legacy layout.
    }
  }
  return null;
}
