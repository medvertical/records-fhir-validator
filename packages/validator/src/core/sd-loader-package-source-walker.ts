import { promises as fs } from 'fs';
import * as path from 'path';
import type { StructureDefinition } from './structure-definition-types.js';
import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { packageTargetMetadata } from '../package/package-artifact-policy.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { selectPackageVersions } from './sd-loader-package-selection.js';

const MAX_PACKAGE_PROFILE_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

export interface PackageSourceWalkOptions {
  packageVersionPins: Record<string, string>;
  deduplicateEnabled: boolean;
}

export interface PackageSourceWalkResult {
  scannedCount: number;
  sourceProfiles: Set<string>;
  packageDetails: Array<{ name: string; profileCount: number }>;
  skippedPackageCount: number;
}

function parsePackageJson(content: string): unknown {
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

/** Parse `packageId#version`, using 0.0.0 for legacy unversioned folders. */
export function parsePackageName(packageName: string): { baseName: string; version: string } | null {
  const parts = packageName.split('#');
  if (parts.length === 2) {
    return parts[0] && parts[1] ? { baseName: parts[0], version: parts[1] } : null;
  }
  if (parts.length !== 1 || !packageName) return null;
  return { baseName: packageName, version: '0.0.0' };
}

export async function scanPackageDirectory(
  packagePath: string,
  availableProfiles: Set<string>,
  onProfile?: (profile: StructureDefinition) => void,
): Promise<void> {
  try {
    const files = (await fs.readdir(packagePath, { withFileTypes: true }))
      .filter(file => file.isFile() && file.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name));

    // Inventory needs canonical identities only. Profile loading still reads
    // and validates the actual StructureDefinition when it is requested.
    const indexed = !onProfile && await readIndexedProfiles(packagePath, files.map(file => file.name));
    if (indexed) {
      for (const canonical of indexed) availableProfiles.add(canonical);
      return;
    }

    for (const file of files) {
      const filePath = path.join(packagePath, file.name);

      try {
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_PACKAGE_PROFILE_BYTES) {
          logger.warn('[SDLoader] Skipping oversized package profile file', {
            size: stats.size,
          });
          continue;
        }
        const content = await fs.readFile(filePath, 'utf-8');
        const sd = parsePackageJson(content) as StructureDefinition;

        if (sd?.resourceType === 'StructureDefinition' && sd.url) {
          availableProfiles.add(sd.url);
          if (typeof sd.version === 'string' && sd.version.length > 0) {
            availableProfiles.add(`${sd.url}|${sd.version}`);
          }
          onProfile?.(sd);
        }
      } catch (error) {
        logger.debug(
          '[SDLoader] Package profile file could not be read',
          validationFailureMetadata(error),
        );
      }
    }
  } catch (error) {
    logger.debug(
      '[SDLoader] Package directory could not be scanned',
      validationFailureMetadata(error),
    );
  }
}

async function readIndexedProfiles(packagePath: string, files: string[]): Promise<Set<string> | null> {
  try {
    const indexPath = path.join(packagePath, '.index.json');
    const stats = await fs.stat(indexPath);
    if (!stats.isFile() || stats.size > MAX_PACKAGE_INDEX_BYTES) return null;
    const index = parsePackageJson(await fs.readFile(indexPath, 'utf-8'));
    if (!index || typeof index !== 'object' || !('files' in index) || !Array.isArray(index.files)) return null;

    const indexedFiles = new Set<string>();
    const actualFiles = new Set(files);
    const profiles = new Set<string>();
    for (const entry of index.files as unknown[]) {
      if (!entry || typeof entry !== 'object' || !('filename' in entry)
        || typeof entry.filename !== 'string' || !('resourceType' in entry)
        || typeof entry.resourceType !== 'string') return null;
      indexedFiles.add(entry.filename);
      if (entry.resourceType !== 'StructureDefinition') continue;
      if (!('url' in entry) || typeof entry.url !== 'string' || !entry.url) return null;
      // Stale entries must not make a removed profile appear available.
      if (!actualFiles.has(entry.filename)) return null;
      profiles.add(entry.url);
      if ('version' in entry && typeof entry.version === 'string' && entry.version) {
        profiles.add(`${entry.url}|${entry.version}`);
      }
    }
    // Third-party packages may ship partial indexes; keep those discoverable.
    if (files.some(file => file !== 'package.json' && file !== '.index.json' && !indexedFiles.has(file))) return null;
    return profiles;
  } catch {
    return null;
  }
}

export async function walkPackageSource(
  sourcePath: string,
  availableProfiles: Set<string>,
  options: PackageSourceWalkOptions,
): Promise<PackageSourceWalkResult> {
  const entries = (await fs.readdir(sourcePath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  logger.debug('[SDLoader] Scanning package-source entries', {
    entryCount: entries.length,
    ...sensitiveValueMetadata(sourcePath),
  });

  const packageVersions = new Map<string, Array<{ name: string; version: string }>>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'sdloader-profile-index.json') continue;
    const parsed = parsePackageName(entry.name);
    if (!parsed) continue;
    const installedVersions = packageVersions.get(parsed.baseName) ?? [];
    installedVersions.push({ name: entry.name, version: parsed.version });
    packageVersions.set(parsed.baseName, installedVersions);
  }

  const { packagesToScan, skippedPackages } = await selectPackageVersions({
    sourcePath,
    packageVersions,
    packageVersionPins: options.packageVersionPins,
    deduplicateEnabled: options.deduplicateEnabled,
  });
  if (skippedPackages.length > 0) {
    logger.info(
      `[SDLoader] Skipped ${skippedPackages.length} duplicate package version(s) (deduplication enabled)`,
    );
  }

  const sourceProfiles = new Set<string>();
  const packageDetails: Array<{ name: string; profileCount: number }> = [];
  const totalPackages = packagesToScan.length;
  const showProgress = totalPackages > 10;
  let scannedCount = 0;

  if (showProgress) {
    logger.info(`[SDLoader] Scanning ${totalPackages} packages...`);
  }

  for (const packageName of packagesToScan) {
    const packagePath = path.join(sourcePath, packageName, 'package');
    try {
      await fs.access(packagePath);
      const packageProfiles = new Set<string>();
      await scanPackageDirectory(packagePath, packageProfiles);
      for (const profileUrl of packageProfiles) {
        sourceProfiles.add(profileUrl);
        availableProfiles.add(profileUrl);
      }

      packageDetails.push({ name: packageName, profileCount: packageProfiles.size });
      logger.debug('[SDLoader] Scanned package', {
        profileCount: packageProfiles.size,
        ...packageTargetMetadata(packageName),
      });
      scannedCount++;

      if (showProgress && (
        scannedCount % Math.ceil(totalPackages / 10) === 0
        || scannedCount === totalPackages
      )) {
        const percentage = Math.round((scannedCount / totalPackages) * 100);
        logger.info(`[SDLoader] Progress: ${scannedCount}/${totalPackages} packages (${percentage}%)`);
      }
    } catch {
      // A missing or inaccessible package subdirectory is not a scan failure.
    }
  }

  return {
    scannedCount,
    sourceProfiles,
    packageDetails,
    skippedPackageCount: skippedPackages.length,
  };
}
