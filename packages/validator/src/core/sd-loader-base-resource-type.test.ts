import { describe, expect, it } from 'vitest';
import { getCachedBaseResourceType } from './sd-loader-base-resource-type';
import { ProfileMemoryCache } from './sd-loader-profile-memory-cache';
import type { StructureDefinition } from './structure-definition-types';

const PROFILE = 'http://example.org/StructureDefinition/patient';

function cacheWith(entries: Record<string, string>): ProfileMemoryCache {
  const cache = new ProfileMemoryCache();
  for (const [key, type] of Object.entries(entries)) cache.set(key, { type } as StructureDefinition);
  return cache;
}

describe('getCachedBaseResourceType', () => {
  it('reads a profile cached under its unversioned key', () => {
    expect(getCachedBaseResourceType(cacheWith({ [`${PROFILE}:R4`]: 'Patient' }), PROFILE)).toBe('Patient');
  });

  it('reads a profile that was only loaded at a pinned release', () => {
    expect(getCachedBaseResourceType(cacheWith({ [`${PROFILE}|1.4.0:R4`]: 'Patient' }), PROFILE)).toBe('Patient');
  });

  it('does not mistake a longer canonical for the requested one', () => {
    expect(getCachedBaseResourceType(cacheWith({ [`${PROFILE}-extra|1.0.0:R4`]: 'Observation' }), PROFILE))
      .toBeNull();
  });

  it('forgets a pinned release the cache evicted or cleared', () => {
    const cache = cacheWith({ [`${PROFILE}|1.4.0:R4`]: 'Patient', [`${PROFILE}|1.5.4:R4`]: 'Patient' });

    cache.delete(`${PROFILE}|1.4.0:R4`);
    expect(getCachedBaseResourceType(cache, PROFILE)).toBe('Patient');
    cache.delete(`${PROFILE}|1.5.4:R4`);
    expect(getCachedBaseResourceType(cache, PROFILE)).toBeNull();

    cache.set(`${PROFILE}|1.4.0:R4`, { type: 'Patient' } as StructureDefinition);
    cache.clear();
    expect(getCachedBaseResourceType(cache, PROFILE)).toBeNull();
  });
});
