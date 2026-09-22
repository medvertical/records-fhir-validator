import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import type { StructureDefinition } from './structure-definition-types.js';
import {
  cacheKeyForProfile,
  fhirVersionFamily,
  type FhirVersionFamily,
} from './sd-loader-version-utils.js';

export function storeExternalProfile(params: {
  url: string;
  profile: StructureDefinition;
  fhirVersion?: FhirVersionFamily;
  cache: Map<string, StructureDefinition>;
  externalProfileCacheKeys: Set<string>;
  availableProfiles: Set<string>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
}): boolean {
  const {
    url,
    profile,
    fhirVersion,
    cache,
    externalProfileCacheKeys,
    availableProfiles,
    profileLoadPromises,
  } = params;
  if (!url || !profile?.url) return false;

  const sanitized = sanitizeProfile(profile);
  const family = fhirVersionFamily(sanitized) ?? fhirVersion ?? 'R4';
  const cacheKey = cacheKeyForProfile(url, family);
  cache.set(cacheKey, sanitized);
  externalProfileCacheKeys.add(cacheKey);
  availableProfiles.add(url);
  profileLoadPromises.delete(cacheKey);
  return true;
}

/**
 * Drop every externally registered profile, leaving bundled and downloaded
 * content untouched. A host that feeds profiles in per unit of work — a
 * conformance case, a request scoped to one IG — needs each unit to see only
 * what it supplied, otherwise a profile registered earlier stays resolvable and
 * the result depends on execution order.
 */
export function clearExternalProfiles(params: {
  cache: Map<string, StructureDefinition>;
  externalProfileCacheKeys: Set<string>;
  availableProfiles: Set<string>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
}): number {
  const { cache, externalProfileCacheKeys, availableProfiles, profileLoadPromises } = params;
  let removed = 0;
  for (const cacheKey of externalProfileCacheKeys) {
    cache.delete(cacheKey);
    profileLoadPromises.delete(cacheKey);
    // The key is `${url}:${family}` — the family never contains a colon.
    availableProfiles.delete(cacheKey.slice(0, cacheKey.lastIndexOf(':')));
    removed += 1;
  }
  externalProfileCacheKeys.clear();
  return removed;
}
