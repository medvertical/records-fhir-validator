import { versionedCacheKey } from './valueset-package-utils.js';
export type FhirVersion = 'R4' | 'R5' | 'R6';

export function versionedExpansionCacheKey(valueSetUrl: string, fhirVersion?: FhirVersion): string {
  const [canonical, requestedVersion] = valueSetUrl.split('|');
  return versionedCacheKey(canonical, requestedVersion, fhirVersion);
}
