import { lookupProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import type { StructureDefinition } from './structure-definition-types.js';
import {
  canonicalVersionMatches,
  fhirVersionFamily,
  matchesRequestedFhirVersion,
  normalizeVersionedCoreStructureDefinitionUrl,
  parseProfileCanonical,
  urlMatchesRequestedFhirVersion,
  type FhirVersionFamily,
} from './sd-loader-version-utils.js';

export function profileMatchesCanonical(
  profile: { resourceType: 'StructureDefinition'; url: string; version?: string; fhirVersion?: unknown },
  requestedUrl: string,
  family: FhirVersionFamily = fhirVersionFamily(profile) ?? 'R4',
): boolean {
  const request = parseProfileCanonical(requestedUrl);
  if (!request || profile.resourceType !== 'StructureDefinition' || typeof profile.url !== 'string') return false;
  if (!urlMatchesRequestedFhirVersion(requestedUrl, family) || !matchesRequestedFhirVersion(profile, family)) return false;
  // Release-qualified core URLs are defined by FHIR. Spelling aliases of IG
  // canonicals do not establish the identity of the requested definition.
  const requestedCanonical = normalizeVersionedCoreStructureDefinitionUrl(request.canonical, family);
  if (profile.url !== request.canonical && profile.url !== requestedCanonical) return false;
  return request.version === undefined || canonicalVersionMatches(profile.version, request.version, family);
}

/** A cached generated snapshot belongs to the selected source definition. */
export function sameProfileDefinition(left: StructureDefinition, right: StructureDefinition): boolean {
  const { snapshot: _leftSnapshot, ...leftSource } = left;
  const { snapshot: _rightSnapshot, ...rightSource } = right;
  return JSON.stringify(lookupProfilePackageProvenance(left)) === JSON.stringify(lookupProfilePackageProvenance(right))
    && JSON.stringify(leftSource) === JSON.stringify(rightSource);
}
