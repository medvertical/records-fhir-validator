// FHIR IG package pins for the MII 2026 and HL7 Europe EHDS 2026 presets.

import type { ValidationSettings } from '../settings.js';

export type MiiTerminologyMode = 'mii-local-blaze' | 'mii-ontoserver' | 'mii-hybrid';

export interface FhirPackagePin {
  id: string;
  version: string;
}

// The version the EPS 1.0.0-ballot closure declares as its dependency.
export const IPS_PACKAGE_VERSION = '2.0.0' as const;

// The version the international IPS validation target checks against. It ships
// alongside the closure version, because one bundle has to serve both.
export const IPS_TARGET_PACKAGE_VERSION = '2.0.1' as const;

export const FHIR_CORE_PACKAGE_VERSIONS = {
  'hl7.fhir.r4.core': '4.0.1',
  'hl7.fhir.r4b.core': '4.3.0',
  'hl7.fhir.r5.core': '5.0.0',
  'hl7.fhir.r6.core': '6.0.0-ballot4',
} as const;

export const FHIR_CORE_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  FHIR_CORE_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

export const FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS = {
  'hl7.terminology.r4': '7.1.0',
  'hl7.terminology.r5': '7.1.0',
} as const;

export const FHIR_CORE_TERMINOLOGY_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

export const FHIR_CORE_EXTENSION_PACKAGE_VERSIONS = {
  'hl7.fhir.uv.extensions.r4': '5.3.0',
  'hl7.fhir.uv.extensions.r5': '5.3.0',
} as const;

export const FHIR_CORE_EXTENSION_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  FHIR_CORE_EXTENSION_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

export const MII_2026_PACKAGE_VERSIONS = {
  'de.basisprofil.r4': '1.5.4',
  'de.medizininformatikinitiative.kerndatensatz.meta': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.base': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.medikation': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.consent': '2026.0.1-rc-2',
  // Direct dependency of the MII consent package. It owns the
  // fhir.de/ConsentManagement profiles referenced by consent resources.
  'de.einwilligungsmanagement': '2.0.3',
  'de.medizininformatikinitiative.kerndatensatz.bildgebung': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.biobank': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.molgen': '2026.0.4',
  'de.medizininformatikinitiative.kerndatensatz.onkologie': '2026.0.3',
  'de.medizininformatikinitiative.kerndatensatz.patho': '2026.0.2',
  'de.medizininformatikinitiative.kerndatensatz.icu': '2026.0.2',
  'de.medizininformatikinitiative.kerndatensatz.pros': '2026.3.0',
  'de.medizininformatikinitiative.kerndatensatz.studie': '2026.0.2',
  'de.medizininformatikinitiative.kerndatensatz.seltene': '2026.0.1',
  // The ICU 2026 examples reference gematik ISiK `sd-mii-icu-*` profiles
  // that are not present in the older `de.gematik.isik-basismodul` package.
  'de.gematik.isik': '5.1.0',
} as const;

export const MII_2026_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  MII_2026_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

export const HL7_EU_EHDS_2026_PACKAGE_VERSIONS = {
  'hl7.fhir.eu.extensions.r4': '1.3.0',
  'hl7.fhir.eu.base': '2.0.0',
  'hl7.fhir.eu.laboratory': '2.0.0',
  'hl7.fhir.eu.eps': '1.0.0-ballot',
  'hl7.fhir.eu.hdr': '0.1.0-ballot',
  // EPS/IPS additional bindings reference eHDSI ValueSets outside the HL7 IGs.
  'myhealth.eu.fhir.mvc-package': '9.1.0',
  'hl7.fhir.eu.imaging': '1.0.0-ballot',
  'hl7.fhir.eu.health-data-api': '1.0.0-ballot',
  // Transitive dependencies declared by the EPS 1.0.0-ballot closure. Pinned
  // explicitly so the offline (BUNDLED_PROFILE_PRESET=ehds-2026) bundle can
  // resolve medication and IPS-derived base profiles without a live registry.
  'hl7.fhir.uv.ips': IPS_PACKAGE_VERSION,
  'hl7.fhir.uv.xver-r5.r4': '0.1.0',
  'ihe.pharm.mpd.r4': '1.0.0-comment-2',
} as const;

// Withdrawn upstream: the 1.0.0-xtehr build is no longer retrievable from
// hl7.eu. It predates the current 1.0.0-ballot publication and remains only as
// a historical comparison marker; do NOT use it as a resolvable pin.
export const HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE: FhirPackagePin = {
  id: 'hl7.fhir.eu.eps.r4',
  version: '1.0.0-xtehr'
};

export const HL7_EU_EHDS_2026_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
).map(([id, version]) => ({ id, version }));

// Overrides accepted by the MII/EHDS settings factories.
export type Mii2026ValidationSettingsOverrides = Omit<
  Partial<ValidationSettings>,
  'packageDownload' | 'profileSources' | 'hapiConfig' | 'mii'
> & {
  packageDownload?: Partial<NonNullable<ValidationSettings['packageDownload']>>;
  profileSources?: Partial<NonNullable<ValidationSettings['profileSources']>>;
  hapiConfig?: Partial<NonNullable<ValidationSettings['hapiConfig']>>;
  mii?: Partial<NonNullable<ValidationSettings['mii']>>;
};

// Pre-rendered `id#version` lists for hapiConfig.igPackages.
export const MII_2026_IG_PACKAGES = MII_2026_PACKAGE_SET.map(({ id, version }) => `${id}#${version}`);
export const HL7_EU_EHDS_2026_IG_PACKAGES = HL7_EU_EHDS_2026_PACKAGE_SET.map(
  ({ id, version }) => `${id}#${version}`
);
