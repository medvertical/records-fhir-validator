import { promises as fs, type Dirent } from 'fs';
import * as path from 'path';
import type { StructureDefinition } from './structure-definition-types.js';
import { logger } from '../logger.js';
import { recordProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { matchesPackageVersionPin } from './sd-loader-package-version-pin.js';
import { crossVersionExtensionSourceRelease, isPartialCanonicalVersion, parseProfileCanonical } from './sd-loader-version-utils.js';
import {
  loadPackageProfileIndex,
  loadProfilesForCanonical,
  packageIndexMayContainCanonical,
  selectBetterUnversionedProfile,
  selectExactProfile,
  selectUnversionedCandidate,
  PackageProfileIndexCache,
  type IndexedProfile,
} from './sd-loader-package-profile-index.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { reportUnreadablePackageStore } from '../package/package-store-diagnostics.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

/** Cross-version and other-release extension packages never serve this release. */
function releaseAdmitsPackage(packageName: string, fhirVersion: 'R4' | 'R5' | 'R6'): boolean {
  return !(packageName.includes('xver') || packageName.includes('extensions.r5'))
    || packageName.startsWith(`hl7.fhir.uv.extensions.${fhirVersion.toLowerCase()}`);
}

/** Canonicals whose package is fixed by the release, not merely preferred by name. */
function hasDefinitiveOwner(url: string): boolean {
  return url.includes('hl7.org/fhir/StructureDefinition/') || crossVersionExtensionSourceRelease(url) !== null;
}

function hl7UvPackagePrefix(url: string): string | null {
  const match = url.toLowerCase().match(/^https?:\/\/hl7\.org\/fhir\/uv\/([^/]+)\//);
  return match ? `hl7.fhir.uv.${match[1]}` : null;
}

const XVER_RELEASE_PACKAGE_SUFFIX: Record<string, string> = {
  '1.0': 'r2', '1.4': 'r2b', '3.0': 'r3', '4.0': 'r4', '4.3': 'r4b', '5.0': 'r5', '6.0': 'r6',
};

export function isRelevantPackage(
  packageName: string,
  url: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  selectedCorePackageId?: string,
): boolean {
  const versionLower = fhirVersion.toLowerCase();

  const sourceRelease = crossVersionExtensionSourceRelease(url);
  if (sourceRelease) {
    const suffix = XVER_RELEASE_PACKAGE_SUFFIX[sourceRelease];
    return Boolean(suffix) && packageName.startsWith(`hl7.fhir.uv.xver-${suffix}.${versionLower}#`);
  }

  if (!releaseAdmitsPackage(packageName, fhirVersion)) return false;

  if (url.includes('hl7.org/fhir/StructureDefinition/')) {
    const corePackage = selectedCorePackageId ?? `hl7.fhir.${versionLower}.core`;
    return packageName.startsWith(corePackage) ||
      packageName.startsWith(`hl7.fhir.uv.extensions.${versionLower}`);
  }

  if (url.includes('hl7.org/fhir/us/core')) {
    return packageName.startsWith('hl7.fhir.us.core');
  }

  const uvPackagePrefix = hl7UvPackagePrefix(url);
  if (uvPackagePrefix) {
    return packageName.toLowerCase().startsWith(uvPackagePrefix);
  }

  if (url.includes('fhir.de') || url.includes('basisprofil')) {
    return packageName.startsWith('de.basisprofil') ||
      packageName.startsWith('de.einwilligungsmanagement');
  }

  if (url.includes('fhir.kbv.de')) {
    if (url.includes('KBV_') && url.includes('_EAU_')) {
      return packageName.startsWith('kbv.ita.eau');
    }
    if (url.includes('KBV_') && url.includes('_FOR_')) {
      return packageName.startsWith('kbv.ita.for');
    }
    return packageName.startsWith('kbv.');
  }

  if (url.includes('hl7.eu/fhir/eps')) {
    return packageName.startsWith('hl7.fhir.eu.eps');
  }

  if (url.includes('hl7.eu/fhir/base')) {
    return packageName.startsWith('hl7.fhir.eu.base');
  }

  if (url.includes('hl7.eu/fhir') || url.includes('hl7.eu/')) {
    return packageName.startsWith('hl7.fhir.eu.');
  }

  if (url.includes('profiles.ihe.net/PHARM/MPD')) {
    return packageName.startsWith('ihe.pharm.mpd.r4');
  }

  if (url.includes('gematik.de') && url.includes('/fhir/isip/')) {
    return packageName.startsWith('de.gematik.isip');
  }

  if (url.includes('gematik.de') && url.includes('/fhir/isik/')) {
    return packageName.startsWith('de.gematik.isik') || packageName.startsWith('de.gematik.isip');
  }

  if (url.includes('medizininformatikinitiative') || url.includes('medizininformatik-initiative') || url.includes('mii')) {
    return packageName.startsWith('de.medizininformatikinitiative');
  }

  if (url.includes('fhir.uk') || url.includes('uk.core') || url.includes('hl7.org.uk')) {
    return packageName.startsWith('UK.Core') ||
      packageName.startsWith('uk.core') ||
      packageName.startsWith('fhir.r4.ukcore') ||
      packageName.startsWith('uk.nhsdigital');
  }

  return true;
}

export async function loadFromLocalCache(
  url: string,
  packageSources: string[],
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  packageVersionPins: Record<string, string> = {},
  indexCache: PackageProfileIndexCache = new PackageProfileIndexCache(),
  selectedCorePackageId?: string,
): Promise<StructureDefinition | null> {
  try {
    const parsed = parseProfileCanonical(url);
    if (!parsed) return null;
    const { canonical: targetUrl, version: targetVersion } = parsed;
    const resourceType = targetUrl.split('/').pop();
    if (!resourceType) return null;
    const request: CanonicalRequest = { targetUrl, targetVersion, resourceType, fhirVersion, packageVersionPins, indexCache };
    const preferred = (packageName: string) =>
      isRelevantPackage(packageName, targetUrl, fhirVersion, selectedCorePackageId);

    return await searchPackageSources(packageSources, request, preferred, url);
  } catch (error) {
    logger.error(
      '[SDLoader] Local profile cache load failed',
      validationFailureMetadata(error),
    );
    return null;
  }
}

async function searchPackageSources(
  packageSources: string[],
  request: CanonicalRequest,
  preferred: (packageName: string) => boolean,
  url: string,
): Promise<StructureDefinition | null> {
  let best: { sd: StructureDefinition; packageName: string; packageDirectory: string } | null = null;
  for (const source of packageSources) {
    try {
      const entries = await fs.readdir(source, { withFileTypes: true });
      // The name heuristics route a canonical to the package that owns it;
      // one they send elsewhere (ig.fhir.de/igs/medication is not
      // de.basisprofil) is still found in whichever package declares it.
      // Core and cross-version canonicals only ever come from their owner.
      const match = await findInPackages(source, entries, preferred, request)
        ?? (hasDefinitiveOwner(request.targetUrl) ? null : await findInPackages(
          source,
          entries,
          packageName => !preferred(packageName) && releaseAdmitsPackage(packageName, request.fhirVersion),
          request,
        ));
      if (match) {
        logger.info(
          '[SDLoader] Loaded profile from local package source',
          profileCanonicalMetadata(url, match.sd.version),
        );
        if (!isPartialCanonicalVersion(request.targetVersion, request.fhirVersion)) {
          recordProfilePackageProvenance(match.sd, match.packageName, match.packageDirectory);
          return match.sd;
        }
        const selected = selectBetterUnversionedProfile(
          best ? { sd: best.sd, sourceName: best.packageName } : null,
          { sd: match.sd, sourceName: match.packageName },
        );
        if (selected?.sd === match.sd) best = match;
      }
    } catch (error) {
      reportUnreadablePackageStore('SDLoader', source, error);
    }
  }
  if (best) recordProfilePackageProvenance(best.sd, best.packageName, best.packageDirectory);
  return best?.sd ?? null;
}

interface CanonicalRequest {
  targetUrl: string;
  targetVersion: string | undefined;
  resourceType: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  packageVersionPins: Record<string, string>;
  indexCache: PackageProfileIndexCache;
}

async function findInPackages(
  source: string,
  entries: Dirent[],
  accepts: (packageName: string) => boolean,
  request: CanonicalRequest,
): Promise<{ sd: StructureDefinition; packageName: string; packageDirectory: string } | null> {
  const { targetUrl, targetVersion, resourceType, fhirVersion, packageVersionPins, indexCache } = request;
  let sourceMatch: IndexedProfile | null = null;
  let sourceMatchDirectory = "";
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!matchesPackageVersionPin(entry.name, packageVersionPins)) continue;
    if (!accepts(entry.name)) continue;

    for (const packagePath of [path.join(source, entry.name, 'package'), path.join(source, entry.name)]) {
      try {
        if (!await packageIndexMayContainCanonical(packagePath, targetUrl, indexCache)) {
          continue;
        }
        // The package index names the files that declare this canonical,
        // so the common case reads one profile instead of every JSON file
        // in the package. Falling back keeps a profile the index omits
        // reachable.
        const index = await loadProfilesForCanonical(packagePath, entry.name, targetUrl, indexCache)
          ?? await loadPackageProfileIndex(packagePath, entry.name, resourceType, indexCache);
        const exact = selectExactProfile(index, targetUrl, targetVersion, fhirVersion, packageVersionPins);
        if (exact) {
          if (targetVersion && !isPartialCanonicalVersion(targetVersion, fhirVersion)) return { sd: exact.sd, packageName: entry.name, packageDirectory: packagePath };
          const selected: IndexedProfile | null = selectBetterUnversionedProfile(sourceMatch, exact);
          if (selected !== sourceMatch) sourceMatchDirectory = packagePath;
          sourceMatch = selected;
        }

        if (!targetVersion && !sourceMatch) {
          sourceMatch = selectUnversionedCandidate(index, targetUrl, fhirVersion, packageVersionPins);
          if (sourceMatch) sourceMatchDirectory = packagePath;
        }
      } catch (error) {
        // One of the two layouts is always absent, which the reporter
        // ignores; anything else means an installed package went
        // unsearched and its profiles resolve as missing.
        reportUnreadablePackageStore('SDLoader', packagePath, error);
        continue;
      }
    }
  }
  return sourceMatch ? { sd: sourceMatch.sd, packageName: sourceMatch.sourceName.split('/')[0], packageDirectory: sourceMatchDirectory } : null;
}

