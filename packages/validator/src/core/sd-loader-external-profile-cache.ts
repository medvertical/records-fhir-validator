import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import type { StructureDefinition } from './structure-definition-types.js';
import {
  cacheKeyForProfile,
  fhirVersionFamily,
  normalizeVersionedCoreStructureDefinitionUrl,
  urlMatchesRequestedFhirVersion,
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

  const family = fhirVersion ?? fhirVersionFamily(profile) ?? 'R4';
  if (!profileMatchesCanonical(profile, url, family)) return false;
  const sanitized = sanitizeProfile(profile);
  const version = typeof sanitized.version === 'string'
    && sanitized.version.length > 0 && !/[\s|#]/.test(sanitized.version)
    ? sanitized.version : null;
  const normalizedUrl = normalizeVersionedCoreStructureDefinitionUrl(url, family);
  if (url.includes('|') && (!version || !urlMatchesRequestedFhirVersion(url, family)
    || !profileMatchesCanonical(sanitized, normalizedUrl, family))) return false;

  const urls = new Set([url]);
  const canonical = normalizedUrl.split('|')[0];
  if (version && profileMatchesCanonical(sanitized, canonical, family)) {
    // A caller's alias cannot attest an edition absent from the definition.
    urls.add(`${canonical}|${version}`);
    if (!url.includes('|')) urls.add(canonical);
  }
  for (const cachedUrl of urls) {
    const cacheKey = cacheKeyForProfile(cachedUrl, family);
    cache.set(cacheKey, sanitized);
    externalProfileCacheKeys.add(cacheKey);
    availableProfiles.add(cachedUrl);
    profileLoadPromises.delete(cacheKey);
  }
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
