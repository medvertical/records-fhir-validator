import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { packageTargetMetadata } from '../package/package-artifact-policy.js';
import { reportUnreadablePackageStore } from '../package/package-store-diagnostics.js';
import { compareVersions } from '../package-resolver/version-comparator.js';

export interface InstalledPackageVersion {
  name: string;
  version: string;
}

export interface PackageSelectionResult {
  packagesToScan: string[];
  skippedPackages: string[];
}

interface PackageSelectionInput {
  sourcePath: string;
  packageVersions: Map<string, InstalledPackageVersion[]>;
  packageVersionPins: Record<string, string>;
  deduplicateEnabled: boolean;
}

async function hasPackageContent(packageDir: string): Promise<boolean> {
  try {
    const files = await fs.readdir(packageDir, { withFileTypes: true });
    return files.some(file => file.isFile() && file.name.endsWith('.json'));
  } catch (error) {
    // Answering "no content" for a directory that could not be read drops the
    // package from the scan entirely, so an installed IG stops resolving and
    // nothing says why.
    reportUnreadablePackageStore('SDLoader', packageDir, error);
    return false;
  }
}

export async function selectPackageVersions({
  sourcePath,
  packageVersions,
  packageVersionPins,
  deduplicateEnabled,
}: PackageSelectionInput): Promise<PackageSelectionResult> {
  const packagesToScan: string[] = [];
  const skippedPackages: string[] = [];

  for (const [baseName, installedVersions] of packageVersions.entries()) {
    const versions = [...installedVersions].sort((left, right) => {
      const byVersion = compareVersions(right.version, left.version);
      return byVersion !== 0 ? byVersion : left.name.localeCompare(right.name);
    });
    const pinnedVersion = Object.hasOwn(packageVersionPins, baseName)
      ? packageVersionPins[baseName]
      : undefined;

    if (pinnedVersion) {
      const selected = versions.find(version => version.version === pinnedVersion) ?? null;
      if (!selected) {
        skippedPackages.push(...versions.map(version => version.name));
        logger.warn('[SDLoader] Pinned package is not installed; skipping local unpinned versions', {
          skippedVersionCount: versions.length,
          ...packageTargetMetadata(`${baseName}#${pinnedVersion}`),
        });
        continue;
      }

      const packageDir = path.join(sourcePath, selected.name, 'package');
      if (!(await hasPackageContent(packageDir))) {
        skippedPackages.push(...versions.map(version => version.name));
        logger.warn(
          '[SDLoader] Pinned package has no package content; skipping local versions',
          packageTargetMetadata(selected.name),
        );
        continue;
      }

      packagesToScan.push(selected.name);
      skippedPackages.push(...versions
        .filter(version => version.name !== selected.name)
        .map(version => version.name));
      logger.debug('[SDLoader] Using pinned package', {
        skippedVersionCount: versions.length - 1,
        ...packageTargetMetadata(selected.name),
      });
      continue;
    }

    if (!deduplicateEnabled || versions.length === 1) {
      packagesToScan.push(...versions.map(version => version.name));
      continue;
    }

    let selected: InstalledPackageVersion | null = null;
    const emptyVersions: string[] = [];
    for (const version of versions) {
      const packageDir = path.join(sourcePath, version.name, 'package');
      if (await hasPackageContent(packageDir)) {
        selected = version;
        break;
      }
      emptyVersions.push(version.name);
      logger.warn(
        '[SDLoader] Package has empty package directory; trying older version',
        packageTargetMetadata(version.name),
      );
    }

    if (!selected) {
      packagesToScan.push(versions[0].name);
      logger.warn('[SDLoader] All package versions have empty package directories', {
        versionCount: versions.length,
        ...packageTargetMetadata(baseName),
      });
      continue;
    }

    packagesToScan.push(selected.name);
    const selectedName = selected.name;
    skippedPackages.push(...versions
      .filter(version => version.name !== selectedName)
      .map(version => version.name));
    if (emptyVersions.length > 0) {
      logger.warn('[SDLoader] Deduplicated package with empty versions', {
        emptyVersionCount: emptyVersions.length,
        ...packageTargetMetadata(selected.name),
      });
    } else {
      logger.debug('[SDLoader] Deduplicated package versions', {
        skippedVersionCount: versions.length - 1,
        ...packageTargetMetadata(selected.name),
      });
    }
  }

  return { packagesToScan, skippedPackages };
}
