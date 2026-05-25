export type FhirVersion = 'R4' | 'R5' | 'R6';

export function versionedExpansionCacheKey(valueSetUrl: string, fhirVersion?: FhirVersion): string {
  if (valueSetUrl.includes('|')) return valueSetUrl;
  return fhirVersion ? `${valueSetUrl}|${fhirVersion}` : valueSetUrl;
}
