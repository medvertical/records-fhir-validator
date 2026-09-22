export const MAX_SCOPED_VALIDATOR_INSTANCES = 8;
export const DEFAULT_SCOPED_PROFILE_CACHE_MAX_ENTRIES = 192;
export const MAX_SCOPED_PROFILE_CACHE_MAX_ENTRIES = 4_096;

export const defaultAllowedPackages = [
  'hl7.fhir.r4.core',
  'hl7.fhir.r4b.core',
  'hl7.fhir.r4.examples',
  'de.gematik.*',
  'de.medizininformatikinitiative.*',
  'de.medizininformatik-initiative.*',
  'de.einwilligungsmanagement',
  'kbv.*',
  'de.basisprofil.*',
  'rki.demis.*',
  'hl7.eu.*',
  'hl7.fhir.us.*',
  'uk.nhsdigital.*',
  'fhir.r4.ukcore.*',
  'hl7.fhir.uk.*',
  'uk.core',
  'uk.core.r4.v2',
  'hl7.fhir.au.*',
  'nictiz.*',
  'iknl.*',
  'ihe.*',
  'hl7.fhir.uv.*',
] as const;

export const emptyPinnedCanonicalFingerprint = {
  algorithm: 'sha256-sorted-canonical-v1' as const,
  count: 0,
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

export function resolveScopedProfileCacheMaxEntries(): number {
  const parsed = Number.parseInt(
    process.env.VALIDATION_SCOPED_PROFILE_CACHE_MAX_ENTRIES ?? '',
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_SCOPED_PROFILE_CACHE_MAX_ENTRIES)
    : DEFAULT_SCOPED_PROFILE_CACHE_MAX_ENTRIES;
}
