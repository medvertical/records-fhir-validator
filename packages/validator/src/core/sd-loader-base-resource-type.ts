import type { ProfileMemoryCache } from './sd-loader-profile-memory-cache.js';

export function getCachedBaseResourceType(
  cache: ProfileMemoryCache,
  canonicalUrl: string,
): string | null {
  const types = new Set<string>();
  for (const suffix of [':R4', ':R5', ':R6', '']) {
    const profile = cache.get(canonicalUrl + suffix);
    if (profile?.type) types.add(profile.type);
  }
  for (const profile of cache.versionedProfiles(canonicalUrl)) if (profile.type) types.add(profile.type);
  return types.size === 1 ? [...types][0] : null;
}
