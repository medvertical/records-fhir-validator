/**
 * Profile-URL → package-ID detection for the FHIR package registry.
 *
 * Fast path: known URL patterns for common national/IG packages.
 * Fallback: the embedder's DB-backed ProfilePackageMapper (when wired).
 */

import { logger } from '../logger';
import { getProfileSource } from '../persistence';

/**
 * Detect package ID from a profile URL.
 * First tries known patterns, then falls back to generic ProfilePackageMapper.
 */
export async function detectPackageForProfile(profileUrl: string): Promise<string | null> {
  logger.info(`[PackageRegistry] Detecting package for profile: ${profileUrl}`);

  // ========================================================================
  // Fast path: Known patterns for common packages
  // ========================================================================

  // US Core: http://hl7.org/fhir/us/core/StructureDefinition/...
  if (profileUrl.includes('hl7.org/fhir/us/core')) {
    logger.info(`[PackageRegistry] ✓ Pattern match: US Core → hl7.fhir.us.core`);
    return 'hl7.fhir.us.core';
  }

  // Da Vinci PDEX Plan-Net: http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/...
  if (profileUrl.includes('hl7.org/fhir/us/davinci-pdex-plan-net')) {
    logger.info(`[PackageRegistry] ✓ Pattern match: Da Vinci PDEX Plan-Net → hl7.fhir.us.davinci-pdex-plan-net`);
    return 'hl7.fhir.us.davinci-pdex-plan-net';
  }

  // Da Vinci PDEX: http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/...
  if (profileUrl.includes('hl7.org/fhir/us/davinci-pdex')) {
    logger.info(`[PackageRegistry] ✓ Pattern match: Da Vinci PDEX → hl7.fhir.us.davinci-pdex`);
    return 'hl7.fhir.us.davinci-pdex';
  }

  // UK Core: https://fhir.hl7.org.uk/StructureDefinition/...
  // Note: UK Core packages are on Simplifier.net
  if (profileUrl.includes('fhir.hl7.org.uk') || profileUrl.includes('fhir.uk')) {
    // UK Core package name on Simplifier: uk.core.r4.v2
    return 'uk.core.r4.v2';
  }

  // Nictiz NL R4 profiles: http://nictiz.nl/fhir/StructureDefinition/...
  if (profileUrl.includes('nictiz.nl/fhir')) {
    return 'nictiz.fhir.nl.r4.nl-core';
  }

  // German Basisprofile: http://fhir.de/StructureDefinition/...
  if (profileUrl.includes('fhir.de') || profileUrl.includes('basisprofil')) {
    return 'de.basisprofil.r4';
  }

  // ISiP: https://gematik.de/fhir/isip/...
  if (profileUrl.includes('gematik.de') && profileUrl.includes('isip')) {
    return 'de.gematik.isip-basismodul';
  }

  // ISiK: https://gematik.de/fhir/isik/...
  if (profileUrl.includes('gematik.de') && profileUrl.includes('isik')) {
    return 'de.gematik.isik-basismodul';
  }

  // MII: https://www.medizininformatik-initiative.de/fhir/...
  if (profileUrl.includes('medizininformatik') || profileUrl.includes('mii')) {
    const normalizedProfileUrl = profileUrl.toLowerCase();
    const isMii2026 = /\|2026\./.test(normalizedProfileUrl) || normalizedProfileUrl.includes('/2026/');

    // Detect specific MII module from URL
    if (isMii2026 && (
      normalizedProfileUrl.includes('/modul-person/') ||
      normalizedProfileUrl.includes('/modul-diagnose/') ||
      normalizedProfileUrl.includes('/modul-prozedur/') ||
      normalizedProfileUrl.includes('/modul-fall/')
    )) {
      return 'de.medizininformatikinitiative.kerndatensatz.base';
    }
    if (normalizedProfileUrl.includes('/modul-person/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.person';
    }
    if (normalizedProfileUrl.includes('/modul-labor/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.laborbefund';
    }
    if (normalizedProfileUrl.includes('/modul-diagnose/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.diagnose';
    }
    if (normalizedProfileUrl.includes('/modul-prozedur/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.prozedur';
    }
    if (normalizedProfileUrl.includes('/modul-medikation/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.medikation';
    }
    if (normalizedProfileUrl.includes('/modul-consent/') || normalizedProfileUrl.includes('/consent/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.consent';
    }
    if (normalizedProfileUrl.includes('/modul-bildgebung/') || normalizedProfileUrl.includes('/bildgebung/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.bildgebung';
    }
    if (normalizedProfileUrl.includes('/modul-biobank/') || normalizedProfileUrl.includes('/biobank/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.biobank';
    }
    if (
      normalizedProfileUrl.includes('/modul-molgen/') ||
      normalizedProfileUrl.includes('/molgen/') ||
      normalizedProfileUrl.includes('molekulargenetisch')
    ) {
      return 'de.medizininformatikinitiative.kerndatensatz.molgen';
    }
    if (normalizedProfileUrl.includes('/modul-onkologie/') || normalizedProfileUrl.includes('/onkologie/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.onkologie';
    }
    if (normalizedProfileUrl.includes('/modul-patho/') || normalizedProfileUrl.includes('/patho/')) {
      return 'de.medizininformatikinitiative.kerndatensatz.patho';
    }
    if (
      normalizedProfileUrl.includes('/modul-icu/') ||
      normalizedProfileUrl.includes('/icu/') ||
      normalizedProfileUrl.includes('/intensivmedizin/')
    ) {
      return 'de.medizininformatikinitiative.kerndatensatz.icu';
    }

    return isMii2026
      ? 'de.medizininformatikinitiative.kerndatensatz.base'
      : 'de.medizininformatikinitiative.kerndatensatz.person';
  }

  // KBV: https://fhir.kbv.de/StructureDefinition/...
  if (profileUrl.includes('fhir.kbv.de')) {
    return 'kbv.basis';
  }

  // Australian eRequesting: http://hl7.org.au/fhir/ereq/StructureDefinition/...
  if (profileUrl.includes('hl7.org.au/fhir/ereq')) {
    return 'hl7.fhir.au.ereq';
  }

  // Australian Base: http://hl7.org.au/fhir/StructureDefinition/...
  if (profileUrl.includes('hl7.org.au')) {
    return 'hl7.fhir.au.base';
  }

  // HL7 Europe EPS branch packages are not consistently published through
  // the public package registry. The package manifest name includes the R4
  // suffix even when the IG is referred to as hl7.fhir.eu.eps.
  if (profileUrl.includes('hl7.eu/fhir/eps')) {
    return 'hl7.fhir.eu.eps.r4';
  }

  if (profileUrl.includes('hl7.eu/fhir/base')) {
    return 'hl7.fhir.eu.base';
  }

  // Canadian Baseline: http://hl7.org/fhir/ca/baseline/StructureDefinition/...
  if (profileUrl.includes('hl7.org/fhir/ca')) {
    return 'hl7.fhir.ca.baseline';
  }

  // WHO ANC-CDS: http://fhir.org/guides/who/anc-cds/StructureDefinition/...
  if (profileUrl.includes('fhir.org/guides/who/anc-cds') || profileUrl.includes('who.anc-cds')) {
    logger.info(`[PackageRegistry] Detected WHO ANC-CDS profile: ${profileUrl}`);
    return 'who.fhir.anc-cds';
  }

  // ========================================================================
  // Generic discovery: Use ProfilePackageMapper for unknown packages
  // ========================================================================

  logger.info(`[PackageRegistry] Unknown profile URL, using generic discovery: ${profileUrl}`);

  try {
    // Use the embedder's package-mapping fallback (server wires the
    // DB-backed ProfilePackageMapper here; standalone callers skip).
    const find = getProfileSource().findPackageForProfile;
    if (find) {
      const packageInfo = await find(profileUrl);
      if (packageInfo) {
        logger.info(`[PackageRegistry] ✓ Generic discovery found: ${packageInfo.packageId} (confidence: ${packageInfo.confidenceScore ?? 'n/a'})`);
        return packageInfo.packageId;
      }
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[PackageRegistry] Generic discovery failed:`, err.message);
  }

  logger.warn(`[PackageRegistry] Could not detect package for profile: ${profileUrl}`);
  return null;
}
