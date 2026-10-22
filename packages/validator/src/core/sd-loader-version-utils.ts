
export type FhirVersionFamily = 'R4' | 'R5' | 'R6';

export function fhirVersionFamily(sd: { resourceType: unknown; fhirVersion?: unknown }): FhirVersionFamily | null {
  const sdFhirVersion = sd.fhirVersion;
  if (typeof sdFhirVersion !== 'string' || !/^[456]\.\d+\.\d+(?:-[^\s|]+)?$/.test(sdFhirVersion)) return null;
  if (sdFhirVersion.startsWith('4.')) return 'R4';
  if (sdFhirVersion.startsWith('5.')) return 'R5';
  if (sdFhirVersion.startsWith('6.')) return 'R6';
  return null;
}

export function matchesRequestedFhirVersion(
  sd: { resourceType: unknown; fhirVersion?: unknown },
  fhirVersion: FhirVersionFamily
): boolean {
  const family = fhirVersionFamily(sd);
  return sd.fhirVersion === undefined || family === fhirVersion;
}

/**
 * `http://hl7.org/fhir/5.0/StructureDefinition/extension-AuditEvent.category`
 * carries an element of FHIR 5.0 into another release. Its definition is
 * published for the release that uses it (`hl7.fhir.uv.xver-r5.r4` for R4),
 * so the version in the URL says nothing about where it may be used.
 */
const CROSS_VERSION_EXTENSION_URL = /^https?:\/\/hl7\.org\/fhir\/(\d\.\d)(?:\.\d+)?\/StructureDefinition\/extension-/;
const CROSS_VERSION_PROFILE_URL = /^https?:\/\/hl7\.org\/fhir\/[456]\.0(?:\.\d+)?\/StructureDefinition\/profile-/;

export function crossVersionExtensionSourceRelease(url: string): string | null {
  return url.match(CROSS_VERSION_EXTENSION_URL)?.[1] ?? null;
}

export function urlFhirVersionFamily(url: string): FhirVersionFamily | null {
  if (crossVersionExtensionSourceRelease(url) || CROSS_VERSION_PROFILE_URL.test(url)) return null;
  const match = url.match(/\/fhir\/([456])\.0(?:\.\d+)?\/StructureDefinition\//);
  if (!match) return null;
  if (match[1] === '4') return 'R4';
  if (match[1] === '5') return 'R5';
  if (match[1] === '6') return 'R6';
  return null;
}

export function urlMatchesRequestedFhirVersion(
  url: string,
  fhirVersion: FhirVersionFamily
): boolean {
  if (!parseProfileCanonical(url)) return false;
  const family = urlFhirVersionFamily(url);
  return !family || family === fhirVersion;
}

export function normalizeVersionedCoreStructureDefinitionUrl(
  url: string,
  fhirVersion: FhirVersionFamily
): string {
  if (!urlMatchesRequestedFhirVersion(url, fhirVersion) || crossVersionExtensionSourceRelease(url)
    || CROSS_VERSION_PROFILE_URL.test(url)) return url;

  const [canonicalUrl, version] = url.split('|');
  const match = canonicalUrl.match(/^http:\/\/hl7\.org\/fhir\/[456]\.0(?:\.\d+)?\/StructureDefinition\/(.+)$/);
  if (!match) return url;

  const normalized = `http://hl7.org/fhir/StructureDefinition/${match[1]}`;
  return version ? `${normalized}|${version}` : normalized;
}

/** Preserve the original canonical when a policy adds an edition pin. */
export function resolveProfileRequest(
  url: string,
  family: FhirVersionFamily,
  resolvePinnedCanonical: (canonical: string) => string,
): string | null {
  if (!urlMatchesRequestedFhirVersion(url, family)) return null;
  const lookup = normalizeVersionedCoreStructureDefinitionUrl(url, family);
  const resolved = resolvePinnedCanonical(lookup);
  if (!urlMatchesRequestedFhirVersion(resolved, family)
    || parseProfileCanonical(resolved)?.canonical !== parseProfileCanonical(lookup)?.canonical) return null;
  return resolved;
}

export function parseProfileCanonical(url: string): { canonical: string; version?: string } | null {
  const parts = url.split('|');
  if (parts.length > 2 || !parts[0] || /\s/.test(parts[0])) return null;
  if (parts.length === 2 && (!parts[1] || /\s/.test(parts[1]))) return null;
  return { canonical: parts[0], ...(parts.length === 2 ? { version: parts[1] } : {}) };
}

/** R5/R6 partial canonical versions name a selection range, not a patch alias. */
export function isPartialCanonicalVersion(version: string | undefined, family: FhirVersionFamily): boolean {
  return family !== 'R4' && typeof version === 'string' && /^\d+(?:\.\d+)?$/.test(version);
}

export function canonicalVersionMatches(actual: string | undefined, requested: string, family: FhirVersionFamily): boolean {
  if (actual === requested) return true;
  if (typeof actual !== 'string' || !isPartialCanonicalVersion(requested, family)) return false;
  return actual.startsWith(`${requested}.`) && /^\d+(?:\.\d+){1,2}(?:[-+][^\s|]+)?$/.test(actual);
}

/** US Core canonicals whose id is not all lower case; a case alias resolves to them. */
const US_CORE_MIXED_CASE_IDS = new Map(['us-core-genderIdentity'].map(id => [id.toLowerCase(), id]));

export function normalizeKnownStructureDefinitionCanonicalUrl(url: string): string {
  const [canonicalUrl, version] = url.split('|');
  const normalizedUsCore = canonicalUrl.replace(
    /^(https?:\/\/hl7\.org\/fhir\/us\/core\/StructureDefinition\/)(us-core-[^/|]+)$/i,
    (_match, prefix: string, profileId: string) =>
      `${prefix}${US_CORE_MIXED_CASE_IDS.get(profileId.toLowerCase()) ?? profileId.toLowerCase()}`,
  );
  const normalizedDaVinci = normalizedUsCore.replace(
    /^https?:\/\/hl7\.org\/fhir\/us\/davinci-crd(?:\/R4)?\/StructureDefinition\/profile-devicerequest-r4$/i,
    'http://hl7.org/fhir/us/davinci-crd/StructureDefinition/profile-devicerequest',
  );
  const normalizedMiiMolgen = normalizedDaVinci.replace(
    /^(https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-molgen\/StructureDefinition\/)(genomic-study(?:-analysis)?)$/i,
    (_match, prefix: string, profileId: string) => `${prefix}mii-pr-molgen-${profileId}`,
  );
  const normalized = normalizedMiiMolgen
    .replace(
      /^https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-mtb\/StructureDefinition\/mii-pr-mtb-biomarker-insituhybridization$/i,
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-insituhybridization',
    )
    .replace(
      /^https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-mtb\/StructureDefinition\/mii-pr-mtb-immunohistochemistry-msi$/i,
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-msi',
    )
    .replace(
      /^https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-mtb\/StructureDefinition\/mii-pr-mtb-systemische-therapie-medication-statement$/i,
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-systemtherapie-medication-statement',
    );
  return version ? `${normalized}|${version}` : normalized;
}

export function cacheKeyForProfile(
  url: string,
  fhirVersion: FhirVersionFamily
): string {
  return `${url}:${fhirVersion}`;
}
