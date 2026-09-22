import type { LoadedIGPackage } from './sd-loader-ig-package.js';
import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { cacheKeyForProfile, fhirVersionFamily } from './sd-loader-version-utils.js';

export function cacheLoadedIGPackage(params: {
  loaded: LoadedIGPackage;
  cache: Map<string, StructureDefinition>;
  availableProfiles: Set<string>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
}): void {
  const {
    loaded,
    cache,
    availableProfiles,
    profileLoadPromises,
  } = params;

  for (const profile of loaded.profiles) {
    const sanitized = sanitizeProfile(profile);
    const family = fhirVersionFamily(sanitized) ?? 'R4';
    const canonicals = [
      sanitized.url,
      ...(sanitized.version ? [`${sanitized.url}|${sanitized.version}`] : []),
    ];
    for (const canonical of canonicals) {
      const cacheKey = cacheKeyForProfile(canonical, family);
      cache.set(cacheKey, sanitized);
      availableProfiles.add(canonical);
      profileLoadPromises.delete(cacheKey);
    }
  }
}
