// FHIR IG package pins for the MII 2026 and HL7 Europe EHDS 2026 presets.

import type { ValidationSettings } from '../settings';

export type MiiTerminologyMode = 'mii-local-blaze' | 'mii-ontoserver' | 'mii-hybrid';

export interface FhirPackagePin {
  id: string;
  version: string;
}

export const MII_2026_PACKAGE_VERSIONS = {
  'de.basisprofil.r4': '1.5.4',
  'de.medizininformatikinitiative.kerndatensatz.meta': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.base': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.medikation': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.consent': '2026.0.1-rc-2',
  'de.medizininformatikinitiative.kerndatensatz.bildgebung': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.biobank': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.molgen': '2026.0.4',
  'de.medizininformatikinitiative.kerndatensatz.onkologie': '2026.0.3',
  'de.medizininformatikinitiative.kerndatensatz.patho': '2026.0.2',
  'de.medizininformatikinitiative.kerndatensatz.icu': '2026.0.2',
} as const;

export const MII_2026_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  MII_2026_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

export const HL7_EU_EHDS_2026_PACKAGE_VERSIONS = {
  'hl7.fhir.eu.extensions.r4': '1.3.0',
  'hl7.fhir.eu.base': '2.0.0',
  'hl7.fhir.eu.laboratory': '2.0.0',
  'hl7.fhir.eu.eps.r4': '1.0.0-alpha',
  'hl7.fhir.eu.hdr': '0.1.0-ballot',
  'hl7.fhir.eu.imaging': '1.0.0-ballot',
  'hl7.fhir.eu.health-data-api': '1.0.0-ballot',
  // Transitive dependencies declared by the EPS 1.0.0-alpha closure. Pinned
  // explicitly so the offline (BUNDLED_PROFILE_PRESET=ehds-2026) bundle can
  // resolve medication and IPS-derived base profiles without a live registry.
  'hl7.fhir.uv.ips': '2.0.0',
  'ihe.pharm.mpd.r4': '1.0.0-comment-2',
} as const;

// Withdrawn upstream: the 1.0.0-xtehr build is no longer retrievable from
// hl7.eu and was superseded by 1.0.0-alpha (re-published after the IHE
// Connectathon, confirmed by K. Heitmann, May 2026). Kept only as a historical
// marker; do NOT use as a resolvable pin.
export const HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE: FhirPackagePin = {
  id: 'hl7.fhir.eu.eps.r4',
  version: '1.0.0-xtehr'
};

export const HL7_EU_EHDS_2026_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS
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
