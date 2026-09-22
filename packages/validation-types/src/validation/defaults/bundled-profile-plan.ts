import {
  FHIR_CORE_EXTENSION_PACKAGE_SET,
  FHIR_CORE_PACKAGE_SET,
  FHIR_CORE_TERMINOLOGY_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  IPS_TARGET_PACKAGE_VERSION,
  MII_2026_PACKAGE_SET,
  type FhirPackagePin,
} from './ig-packages.js';

export const BUNDLED_PROFILE_PRESETS = ['default', 'mii-2026', 'ehds-2026'] as const;

export type BundledProfilePreset = typeof BUNDLED_PROFILE_PRESETS[number];

const DEFAULT_BUNDLED_PROFILE_PACKAGE_SET: FhirPackagePin[] = [
  ...FHIR_CORE_PACKAGE_SET,
  ...FHIR_CORE_TERMINOLOGY_PACKAGE_SET,
  ...FHIR_CORE_EXTENSION_PACKAGE_SET,
];

export interface BundledProfilePlan {
  preset: BundledProfilePreset;
  packages: readonly FhirPackagePin[];
  ownedDependencyPrefixes: readonly string[];
  requiredDependencyIds: readonly string[];
}

export function parseBundledProfilePreset(
  value: string | undefined,
  fallback: BundledProfilePreset = 'default',
): BundledProfilePreset {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (isBundledProfilePreset(normalized)) return normalized;
  throw new Error(`Unsupported bundled profile preset: ${normalized}`);
}

export function getBundledProfilePlan(preset: BundledProfilePreset): BundledProfilePlan {
  // Keyed by id and version: a bundle may carry two versions of one package
  // when separate consumers pin different ones.
  const packages = new Map(
    DEFAULT_BUNDLED_PROFILE_PACKAGE_SET.map(pin => [`${pin.id}#${pin.version}`, pin] as const),
  );
  if (preset === 'mii-2026') {
    for (const pin of MII_2026_PACKAGE_SET) packages.set(`${pin.id}#${pin.version}`, pin);
  }
  if (preset === 'ehds-2026') {
    for (const pin of HL7_EU_EHDS_2026_PACKAGE_SET) packages.set(`${pin.id}#${pin.version}`, pin);
    // Offer the explicit IPS target without changing EPS's active dependency pin.
    const ipsTarget = { id: 'hl7.fhir.uv.ips', version: IPS_TARGET_PACKAGE_VERSION };
    packages.set(`${ipsTarget.id}#${ipsTarget.version}`, ipsTarget);
  }

  return {
    preset,
    packages: [...packages.values()],
    ownedDependencyPrefixes: preset === 'default'
      ? []
      : preset === 'mii-2026'
        ? ['de.medizininformatikinitiative.']
        : ['hl7.fhir.eu.', 'ihe.pharm.'],
    requiredDependencyIds: preset === 'mii-2026' ? ['de.einwilligungsmanagement'] : [],
  };
}

export function isBundledProfilePreset(value: string): value is BundledProfilePreset {
  return (BUNDLED_PROFILE_PRESETS as readonly string[]).includes(value);
}
