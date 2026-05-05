/**
 * StructureDefinition Loader - Filesystem Operations
 * 
 * Utilities for loading StructureDefinitions from local filesystem.
 * Extracted from structure-definition-loader.ts to comply with global.mdc guidelines.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { StructureDefinition } from './structure-definition-types';
import { logger } from '../logger';

/**
 * Check if a package is relevant for a given profile URL and version
 */
export function isRelevantPackage(
  packageName: string,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6'
): boolean {
  const versionLower = fhirVersion.toLowerCase();

  // Exclude cross-version extension packages for core FHIR types
  // These packages (xver, extensions.r5) contain R5 extensions that should not
  // be used when loading core R4 StructureDefinitions
  if (packageName.includes('xver') || packageName.includes('extensions.r5')) {
    // Only include for extension URLs, not core resources
    if (!url.includes('/Extension/')) {
      return false;
    }
  }

  // Core FHIR profiles
  if (url.includes('hl7.org/fhir/StructureDefinition/')) {
    return packageName.startsWith(`hl7.fhir.${versionLower}.core`);
  }

  // US Core
  if (url.includes('hl7.org/fhir/us/core')) {
    return packageName.startsWith('hl7.fhir.us.core');
  }

  // German profiles (Basisprofil + Einwilligungsmanagement)
  if (url.includes('fhir.de') || url.includes('basisprofil')) {
    return packageName.startsWith('de.basisprofil') ||
      packageName.startsWith('de.einwilligungsmanagement');
  }

  // ISiP profiles (nursing care – de.gematik.isip package)
  if (url.includes('isip')) {
    return packageName.startsWith('de.gematik.isip');
  }

  // ISiK profiles (hospital interoperability – de.gematik.isik packages)
  if (url.includes('gematik.de') || url.includes('isik')) {
    return packageName.startsWith('de.gematik.isik') || packageName.startsWith('de.gematik.isip');
  }

  // MII profiles
  if (url.includes('medizininformatikinitiative') || url.includes('medizininformatik-initiative') || url.includes('mii')) {
    return packageName.startsWith('de.medizininformatikinitiative');
  }

  // UK Core - support multiple package naming conventions
  if (url.includes('fhir.uk') || url.includes('uk.core') || url.includes('hl7.org.uk')) {
    return packageName.startsWith('UK.Core') ||
      packageName.startsWith('uk.core') ||
      packageName.startsWith('fhir.r4.ukcore') ||
      packageName.startsWith('uk.nhsdigital');
  }

  // If unsure, include package
  return true;
}

/**
 * Load StructureDefinition from local cache (multi-source)
 * Tries sources in priority order: bundled → cache
 */
// eslint-disable-next-line max-lines-per-function
export async function loadFromLocalCache(
  url: string,
  packageSources: string[],
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
): Promise<StructureDefinition | null> {
  try {
    // Handle versioned URLs
    let targetUrl = url;
    let targetVersion: string | undefined;
    if (url.includes('|')) {
      const parts = url.split('|');
      targetUrl = parts[0];
      targetVersion = parts[1];
    }

    // Extract resource type from URL (remove version if present)
    const resourceType = targetUrl.split('/').pop();
    if (!resourceType) return null;

    let urlMatch: StructureDefinition | null = null;
    let urlMatchSource: string = '';

    // Try each package source in priority order
    for (const source of packageSources) {
      try {
        // Read package directories
        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          // Optimization: Skip irrelevant packages based on FHIR version
          if (!isRelevantPackage(entry.name, targetUrl, fhirVersion)) {
            continue;
          }

          // Try both package/ subdirectory and root directory
          const packagePaths = [
            path.join(source, entry.name, 'package'),
            path.join(source, entry.name)
          ];

          for (const packagePath of packagePaths) {
            try {
              await fs.access(packagePath);

              const checkSd = (sd: any, sourceName: string) => {
                if (sd?.resourceType === 'StructureDefinition' && sd.url === targetUrl) {
                  if (!targetVersion || sd.version === targetVersion) {
                    return sd; // Found exact match
                  }
                  // Keep candidate if we haven't found one yet
                  if (!urlMatch) {
                    urlMatch = sd;
                    urlMatchSource = sourceName;
                  }
                }
                return null;
              };

              // Try standard filename: StructureDefinition-{ResourceType}.json
              const fileName = `StructureDefinition-${resourceType}.json`;
              const filePath = path.join(packagePath, fileName);

              try {
                const content = await fs.readFile(filePath, 'utf-8');
                const sd = JSON.parse(content) as StructureDefinition;
                const match = checkSd(sd, `${entry.name}/${fileName}`);
                if (match) {
                  logger.debug(`[SDLoader] Loaded ${url} from ${entry.name}`);
                  return match;
                }
              } catch {
                // File not found with simple name, will search all files below
              }

              // Search all JSON files in package (some IGs don't prefix with "StructureDefinition-")
              const files = await fs.readdir(packagePath);

              for (const file of files) {
                if (!file.endsWith('.json')) {
                  continue;
                }

                const filePath = path.join(packagePath, file);
                try {
                  const content = await fs.readFile(filePath, 'utf-8');
                  const sd = JSON.parse(content) as StructureDefinition;
                  const match = checkSd(sd, `${entry.name}/${file}`);
                  if (match) {
                    logger.debug(`[SDLoader] Loaded ${url} from ${entry.name}/${file}`);
                    return match;
                  }
                } catch {
                  // Parse error or read error, skip this file
                  continue;
                }
              }
            } catch {
              continue; // Try next path
            }
          }
        }
      } catch {
        continue; // Try next source
      }
    }

    // Return candidate if found (and no exact match was returned above)
    if (urlMatch) {
      logger.info(`[SDLoader] Loaded version mismatch for ${url} from ${urlMatchSource} (found version ${(urlMatch as StructureDefinition).version})`);
      return urlMatch;
    }

    return null;
  } catch (error) {
    logger.error(`[SDLoader] Error loading from local cache:`, error);
    return null;
  }
}

/**
 * Load StructureDefinition from a specific source directory
 */
export async function loadFromSource(
  sourcePath: string,
  url: string,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6'
): Promise<StructureDefinition | null> {
  // Scan all package directories for this profile
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageName = entry.name;

    // Determine if this package is relevant based on URL and version
    const isRelevant = isRelevantPackage(packageName, url, fhirVersion);

    if (isRelevant) {
      // Try to load from this package
      const packagePath = path.join(sourcePath, packageName, 'package');

      try {
        // First try the simple filename (e.g., StructureDefinition-Patient.json)
        const simpleFileName = `StructureDefinition-${resourceType}.json`;
        const simpleFilePath = path.join(packagePath, simpleFileName);

        try {
          const content = await fs.readFile(simpleFilePath, 'utf-8');
          const sd = JSON.parse(content) as StructureDefinition;
          if (sd.url === url) {
            return sd;
          }
        } catch {
          // File not found with simple name, will search all files below
        }

        // Search all JSON files in package (some IGs don't prefix with "StructureDefinition-")
        const files = await fs.readdir(packagePath);
        for (const file of files) {
          if (!file.endsWith('.json')) {
            continue;
          }

          const filePath = path.join(packagePath, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const sd = JSON.parse(content) as StructureDefinition;

            if (sd.resourceType === 'StructureDefinition' && sd.url === url) {
              return sd;
            }
          } catch {
            // Parse error or read error, skip this file
            continue;
          }
        }
      } catch {
        // Package directory not accessible, try next package
        continue;
      }
    }
  }

  return null;
}

