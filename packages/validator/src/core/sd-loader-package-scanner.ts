/**
 * StructureDefinition Loader - Package Scanner
 * 
 * Utilities for scanning package directories for StructureDefinitions.
 * Extracted from structure-definition-loader.ts to comply with global.mdc guidelines.
 * 
 * Uses persistent index to avoid rescanning on every startup (saves 2-4s).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { StructureDefinition } from './structure-definition-types';
import { logger } from '../logger';
import { loadFromPersistentIndex, saveToPersistentIndex } from './sd-loader-persistent-index';

export interface ScanCacheDirectoryOptions {
  packageVersionPins?: Record<string, string>;
}

function parsePackageJson(content: string): unknown {
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

/**
 * Parse package name into base name and version
 * Format: packageId#version (e.g., "hl7.fhir.r4.core#4.0.1")
 */
export function parsePackageName(packageName: string): { baseName: string; version: string } | null {
  const parts = packageName.split('#');
  if (parts.length === 2) {
    return { baseName: parts[0], version: parts[1] };
  }
  // No version separator - treat entire name as base
  return { baseName: packageName, version: '0.0.0' };
}

/**
 * Compare semantic versions
 * Returns: positive if v1 > v2, negative if v1 < v2, zero if equal
 */
export function compareVersions(v1: string, v2: string): number {
  // Handle special cases
  if (v1 === v2) return 0;

  // Clean version strings (remove -ballot, -snapshot suffixes for comparison)
  const cleanV1 = v1.split('-')[0];
  const cleanV2 = v2.split('-')[0];

  const parts1 = cleanV1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = cleanV2.split('.').map(p => parseInt(p, 10) || 0);

  // Compare each part
  const maxLength = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) {
      return p1 - p2;
    }
  }

  // If versions are equal, prefer non-pre-release versions
  if (v1.includes('-') && !v2.includes('-')) return -1;
  if (!v1.includes('-') && v2.includes('-')) return 1;

  return 0;
}

/**
 * Check if a package directory has any JSON content
 * Used during deduplication to skip broken/empty downloads
 */
async function hasPackageContent(packageDir: string): Promise<boolean> {
  try {
    const files = await fs.readdir(packageDir);
    return files.some(f => f.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Scan a package directory for StructureDefinitions
 */
export async function scanPackageDirectory(
  packagePath: string,
  availableProfiles: Set<string>
): Promise<void> {
  try {
    const files = await fs.readdir(packagePath);

    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(packagePath, file);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const sd = parsePackageJson(content) as StructureDefinition;

        if (sd?.resourceType === 'StructureDefinition' && sd.url) {
          availableProfiles.add(sd.url);
        }
      } catch (error) {
        logger.debug(`[SDLoader] Error reading ${file}:`, error);
      }
    }
  } catch (error) {
    logger.debug(`[SDLoader] Error scanning package directory ${packagePath}:`, error);
  }
}

/**
 * Scan cache directory for available StructureDefinitions
 * Uses persistent index to avoid rescanning on every startup (saves 2-4s)
 */
// eslint-disable-next-line max-lines-per-function
export async function scanCacheDirectory(
  sourcePath: string,
  availableProfiles: Set<string>,
  options: ScanCacheDirectoryOptions = {}
): Promise<number> {
  try {
    const startTime = Date.now();
    const startProfileCount = availableProfiles.size;
    const packageVersionPins = options.packageVersionPins ?? {};
    const hasVersionPins = Object.keys(packageVersionPins).length > 0;

    // 1. Try to load from persistent index first
    if (!hasVersionPins) {
      const cachedProfiles = await loadFromPersistentIndex(sourcePath);
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
      logger.info(`[SDLoader] Skipping persistent index for ${sourcePath}; package version pins are active`);
    }

    // 2. Index is invalid or missing - do full scan
    logger.info(`[SDLoader] Performing full package scan (index invalid or missing)...`);

    // Scan all package directories in cache (format: packageId#version)
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    logger.debug(`[SDLoader] Scanning ${entries.length} entries in ${sourcePath}`);

    // Group packages by base name to find duplicates
    const packageVersions = new Map<string, Array<{ name: string; version: string }>>();

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'sdloader-profile-index.json') {
        const packageName = entry.name;

        // Parse package name and version (format: packageId#version)
        const parsed = parsePackageName(packageName);
        if (parsed) {
          const { baseName, version } = parsed;
          if (!packageVersions.has(baseName)) {
            packageVersions.set(baseName, []);
          }
          packageVersions.get(baseName)!.push({ name: packageName, version });
        }
      }
    }

    // Select which packages to scan (deduplicate by preferring latest version)
    const packagesToScan: string[] = [];
    const skippedPackages: string[] = [];
    const deduplicateEnabled = process.env.FHIR_DEDUPLICATE_PACKAGES !== 'false';

    for (const [baseName, versions] of packageVersions.entries()) {
      const pinnedVersion = packageVersionPins[baseName];
      if (pinnedVersion) {
        const selected = versions.find((v) => v.version === pinnedVersion) ?? null;
        if (!selected) {
          skippedPackages.push(...versions.map((v) => v.name));
          logger.warn(
            `[SDLoader] Pinned package ${baseName}#${pinnedVersion} is not installed; ` +
            `skipping ${versions.length} local unpinned version(s)`
          );
          continue;
        }

        const packageDir = path.join(sourcePath, selected.name, 'package');
        if (!(await hasPackageContent(packageDir))) {
          skippedPackages.push(...versions.map((v) => v.name));
          logger.warn(`[SDLoader] Pinned package ${selected.name} has no package content; skipping local versions`);
          continue;
        }

        packagesToScan.push(selected.name);
        for (const v of versions) {
          if (v.name !== selected.name) {
            skippedPackages.push(v.name);
          }
        }
        logger.debug(`[SDLoader] Using pinned package ${selected.name}, skipped ${versions.length - 1} unpinned version(s)`);
        continue;
      }

      if (deduplicateEnabled && versions.length > 1) {
        // Sort versions to find latest
        versions.sort((a, b) => compareVersions(b.version, a.version));

        // Pick the latest version that actually has content
        // (protects against broken/incomplete downloads)
        let selected: (typeof versions)[0] | null = null;
        const emptyVersions: string[] = [];

        for (const v of versions) {
          const packageDir = path.join(sourcePath, v.name, 'package');
          if (await hasPackageContent(packageDir)) {
            selected = v;
            break;
          }
          emptyVersions.push(v.name);
          logger.warn(`[SDLoader] Package ${v.name} has empty package directory, trying older version`);
        }

        if (selected) {
          packagesToScan.push(selected.name);
          // Track skipped versions (both empty and older-than-selected)
          for (const v of versions) {
            if (v.name !== selected.name) {
              skippedPackages.push(v.name);
            }
          }
          if (emptyVersions.length > 0) {
            logger.warn(`[SDLoader] Deduplicated ${baseName}: skipped ${emptyVersions.length} empty version(s), using ${selected.name}`);
          } else {
            logger.debug(`[SDLoader] Deduplicated ${baseName}: using ${selected.name}, skipped ${versions.length - 1} older version(s)`);
          }
        } else {
          // All versions empty — include latest anyway (will be scanned with 0 results)
          packagesToScan.push(versions[0].name);
          logger.warn(`[SDLoader] All ${versions.length} versions of ${baseName} have empty package directories`);
        }
      } else {
        // No deduplication or single version - scan all
        packagesToScan.push(...versions.map(v => v.name));
      }
    }

    if (skippedPackages.length > 0) {
      logger.info(`[SDLoader] Skipped ${skippedPackages.length} duplicate package version(s) (deduplication enabled)`);
    }

    // Scan selected packages with progress indicator
    let scannedCount = 0;
    const totalPackages = packagesToScan.length;
    const showProgress = totalPackages > 10; // Show progress only for large scans
    const packageDetails: Array<{ name: string; profileCount: number }> = [];

    if (showProgress) {
      logger.info(`[SDLoader] Scanning ${totalPackages} packages...`);
    }

    for (let i = 0; i < packagesToScan.length; i++) {
      const packageName = packagesToScan[i];
      // Look for package/StructureDefinition-*.json files
      const packagePath = path.join(sourcePath, packageName, 'package');

      try {
        await fs.access(packagePath);
        const profileCountBefore = availableProfiles.size;
        await scanPackageDirectory(packagePath, availableProfiles);
        const profilesInPackage = availableProfiles.size - profileCountBefore;

        // Record package details for index
        packageDetails.push({ name: packageName, profileCount: profilesInPackage });

        logger.debug(`[SDLoader] Scanned package: ${packageName} (${profilesInPackage} profiles)`);
        scannedCount++;

        // Show progress at intervals
        if (showProgress && (scannedCount % Math.ceil(totalPackages / 10) === 0 || scannedCount === totalPackages)) {
          const percentage = Math.round((scannedCount / totalPackages) * 100);
          logger.info(`[SDLoader] Progress: ${scannedCount}/${totalPackages} packages (${percentage}%)`);
        }
      } catch {
        // No package subdirectory or access error, skip silently
      }
    }

    const elapsed = Date.now() - startTime;
    const profilesAdded = availableProfiles.size - startProfileCount;
    logger.info(`[SDLoader] ✓ Found ${profilesAdded} profiles from ${scannedCount} packages in ${elapsed}ms`);

    // 3. Save to persistent index for next startup. Pinned scans are deliberately
    // not persisted because the active pin set changes which local package
    // versions are eligible.
    if (!hasVersionPins) {
      await saveToPersistentIndex(sourcePath, availableProfiles, packageDetails);
    }

    return scannedCount;

  } catch (error) {
    logger.warn(`[SDLoader] Error scanning ${sourcePath}:`, error);
    return 0;
  }
}
