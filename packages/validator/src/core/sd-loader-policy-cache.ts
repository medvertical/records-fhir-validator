import type { StructureDefinition } from './structure-definition-types.js';

export function recordsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
}

export function invalidateProfilePolicyCaches(params: {
  cache: Map<string, StructureDefinition>;
  externalProfileCacheKeys: Set<string>;
  profileLoadPromises: Map<string, Promise<StructureDefinition | null>>;
}, clearReloadableCache: boolean): void {
  const { cache, externalProfileCacheKeys, profileLoadPromises } = params;
  if (clearReloadableCache) {
    for (const cacheKey of cache.keys()) {
      if (!externalProfileCacheKeys.has(cacheKey)) cache.delete(cacheKey);
    }
  }
  profileLoadPromises.clear();
}
