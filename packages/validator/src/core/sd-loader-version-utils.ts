import type { StructureDefinition } from './structure-definition-types';

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

export function cacheKeyForProfile(
  url: string,
  fhirVersion: FhirVersionFamily
): string {
  return `${url}:${fhirVersion}`;
}
