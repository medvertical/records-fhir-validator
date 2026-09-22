import type { StructureDefinition } from './structure-definition-types.js';

export type FhirVersionFamily = 'R4' | 'R5' | 'R6';

export function fhirVersionFamily(sd: StructureDefinition): FhirVersionFamily | null {
  const sdFhirVersion = (sd as { fhirVersion?: string }).fhirVersion;
  if (!sdFhirVersion) return null;
  if (sdFhirVersion.startsWith('4.')) return 'R4';
  if (sdFhirVersion.startsWith('5.')) return 'R5';
  if (sdFhirVersion.startsWith('6.')) return 'R6';
  return null;
}

export function matchesRequestedFhirVersion(
  sd: StructureDefinition,
  fhirVersion: FhirVersionFamily
): boolean {
  const family = fhirVersionFamily(sd);
  return !family || family === fhirVersion;
}

export function urlFhirVersionFamily(url: string): FhirVersionFamily | null {
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
  const family = urlFhirVersionFamily(url);
  return !family || family === fhirVersion;
}

export function normalizeVersionedCoreStructureDefinitionUrl(
  url: string,
  fhirVersion: FhirVersionFamily
): string {
  if (!urlMatchesRequestedFhirVersion(url, fhirVersion)) return url;

  const [canonicalUrl, version] = url.split('|');
  const match = canonicalUrl.match(/^http:\/\/hl7\.org\/fhir\/[456]\.0(?:\.\d+)?\/StructureDefinition\/(.+)$/);
  if (!match) return normalizeKnownStructureDefinitionCanonicalUrl(url);

  const normalized = `http://hl7.org/fhir/StructureDefinition/${match[1]}`;
  return normalizeKnownStructureDefinitionCanonicalUrl(version ? `${normalized}|${version}` : normalized);
}

export function normalizeKnownStructureDefinitionCanonicalUrl(url: string): string {
  const [canonicalUrl, version] = url.split('|');
  const normalizedUsCore = canonicalUrl.replace(
    /^(https?:\/\/hl7\.org\/fhir\/us\/core\/StructureDefinition\/)(us-core-[^/|]+)$/i,
    (_match, prefix: string, profileId: string) => `${prefix}${profileId.toLowerCase()}`,
  );
  const normalizedDaVinci = normalizedUsCore.replace(
    /^https?:\/\/hl7\.org\/fhir\/us\/davinci-crd(?:\/R4)?\/StructureDefinition\/profile-devicerequest-r4$/i,
    'http://hl7.org/fhir/us/davinci-crd/StructureDefinition/profile-devicerequest',
  );
  const normalizedMiiMolgen = normalizedDaVinci.replace(
    /^(https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-molgen\/StructureDefinition\/)(genomic-study(?:-analysis)?)$/i,
    (_match, prefix: string, profileId: string) => `${prefix}mii-pr-molgen-${profileId}`,
  );
  const normalizedMiiIcu = normalizedMiiMolgen.replace(
    /^(https:\/\/www\.medizininformatik-initiative\.de\/fhir\/ext\/modul-icu\/StructureDefinition\/mii-pr-icu-)ect-(.+)$/i,
    '$1$2',
  );
  const normalized = normalizedMiiIcu
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
