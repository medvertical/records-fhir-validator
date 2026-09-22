import type { StructureDefinition } from './structure-definition-types.js';

export function getCachedBaseResourceType(
  cache: Map<string, StructureDefinition>,
  canonicalUrl: string,
): string | null {
  for (const suffix of [':R4', ':R5', '']) {
    const profile = cache.get(canonicalUrl + suffix);
    if (profile?.type) return profile.type;
  }
  return null;
}
