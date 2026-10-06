import type { StructureDefinition } from './structure-definition-types.js';

/**
 * The loader's in-memory profile cache, keyed `canonical[|version]:<release>`.
 * A reference pinned to its referencing profile's dependency release is cached
 * under its versioned key only, and the reference-target check asks for such
 * a profile by its bare canonical for every targetProfile of every validated
 * resource. The versioned keys are therefore also tracked by canonical, so
 * that question never walks the whole cache.
 */
export class ProfileMemoryCache extends Map<string, StructureDefinition> {
  private readonly versionedKeys = new Map<string, Set<string>>();

  // Map's constructor would call the overridden set() before the index exists.
  constructor() {
    super();
  }

  override set(key: string, profile: StructureDefinition): this {
    super.set(key, profile);
    const canonical = versionedCanonicalOf(key);
    if (canonical) {
      const keys = this.versionedKeys.get(canonical) ?? new Set<string>();
      keys.add(key);
      this.versionedKeys.set(canonical, keys);
    }
    return this;
  }

  override delete(key: string): boolean {
    const canonical = versionedCanonicalOf(key);
    const keys = canonical ? this.versionedKeys.get(canonical) : undefined;
    if (canonical && keys?.delete(key) && keys.size === 0) this.versionedKeys.delete(canonical);
    return super.delete(key);
  }

  override clear(): void {
    super.clear();
    this.versionedKeys.clear();
  }

  /** Profiles cached under a versioned key of `canonicalUrl`. */
  versionedProfiles(canonicalUrl: string): StructureDefinition[] {
    const profiles: StructureDefinition[] = [];
    for (const key of this.versionedKeys.get(canonicalUrl) ?? []) {
      const profile = this.get(key);
      if (profile) profiles.push(profile);
    }
    return profiles;
  }
}

function versionedCanonicalOf(key: string): string | null {
  const separator = key.indexOf('|');
  return separator > 0 ? key.slice(0, separator) : null;
}
