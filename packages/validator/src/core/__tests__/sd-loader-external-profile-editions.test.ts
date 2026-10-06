import { describe, expect, it } from 'vitest';
import { storeExternalProfile, clearExternalProfiles } from '../sd-loader-external-profile-cache';
import { urlMatchesRequestedFhirVersion } from '../sd-loader-version-utils';
import type { StructureDefinition } from '../structure-definition-types';

const canonical = 'https://synthetic.records.example/StructureDefinition/edition';
function definition(version: string, fhirVersion = '4.0.1'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: canonical, version, fhirVersion,
    name: 'Edition', status: 'active', kind: 'resource', abstract: false,
    type: 'Patient', snapshot: { element: [{ id: 'Patient', path: 'Patient' }] },
  };
}
function state() {
  return {
    cache: new Map<string, StructureDefinition>(), externalProfileCacheKeys: new Set<string>(),
    availableProfiles: new Set<string>(), profileLoadPromises: new Map<string, Promise<StructureDefinition | null>>(),
  };
}

describe('externally registered business editions', () => {
  it('keeps each attested edition while the bare canonical selects the newest registration', () => {
    const current = state(); const first = definition('1'); const second = definition('2');
    storeExternalProfile({ url: canonical, profile: first, ...current });
    storeExternalProfile({ url: canonical, profile: second, ...current });
    expect(current.cache.get(`${canonical}|1:R4`)).toBe(first);
    expect(current.cache.get(`${canonical}|2:R4`)).toBe(second);
    expect(current.cache.get(`${canonical}:R4`)).toBe(second);
    expect(current.cache.has(`${canonical}|3:R4`)).toBe(false);
  });

  it('uses the actual publication family for an opaque business version', () => {
    const current = state(); const profile = definition('R4', '5.0.0');
    expect(storeExternalProfile({ url: canonical, profile, fhirVersion: 'R4', ...current })).toBe(false);
    storeExternalProfile({ url: canonical, profile, ...current });
    expect(current.cache.get(`${canonical}|R4:R5`)).toBe(profile);
    expect(current.cache.has(`${canonical}|R4:R4`)).toBe(false);
  });

  it('retains the existing R4B family mapping', () => {
    const current = state(); const profile = definition('edition', '4.3.0');
    expect(storeExternalProfile({ url: canonical, profile, fhirVersion: 'R5', ...current })).toBe(false);
    storeExternalProfile({ url: canonical, profile, ...current });
    expect(current.cache.get(`${canonical}|edition:R4`)).toBe(profile);
    expect(current.cache.has(`${canonical}|edition:R5`)).toBe(false);
  });

  it('clears every registered edition and pending alias without removing bundled content', () => {
    const current = state(); const profile = definition('2');
    current.cache.set('bundled:R4', definition('core')); current.availableProfiles.add('bundled');
    current.profileLoadPromises.set(`${canonical}|2:R4`, Promise.resolve(null));
    storeExternalProfile({ url: canonical, profile, ...current });
    expect(current.profileLoadPromises.has(`${canonical}|2:R4`)).toBe(false);
    expect(clearExternalProfiles(current)).toBe(2);
    expect([...current.cache.keys()]).toEqual(['bundled:R4']);
    expect([...current.availableProfiles]).toEqual(['bundled']);
    expect(current.externalProfileCacheKeys.size).toBe(0);
  });

  it('does not let a caller supply an unattested explicit edition', () => {
    const current = state();
    expect(storeExternalProfile({ url: `${canonical}|3`, profile: definition('2'), ...current })).toBe(false);
    expect(current.cache.size).toBe(0);
    expect(current.availableProfiles.size).toBe(0);
  });

  it('rejects a bare opaque alias without changing any cache keys', () => {
    const current = state(); const profile = definition('2'); const alias = `${canonical}-alias`;
    expect(storeExternalProfile({ url: alias, profile, ...current })).toBe(false);
    expect(current.cache.size).toBe(0);
    expect(current.availableProfiles.size).toBe(0);
    expect(current.cache.has(`${alias}|2:R4`)).toBe(false);
  });

  it.each(['', ' ', '2|3', '2#part'])('does not derive an edition key from malformed metadata %j', version => {
    const current = state(); const profile = definition(version);
    expect(storeExternalProfile({ url: canonical, profile, ...current })).toBe(true);
    expect([...current.cache.keys()]).toEqual([`${canonical}:R4`]);
  });

  it.each([`${canonical}|`, `${canonical}|2|3`, `${canonical}| 2`])('rejects an ambiguous request before normalization %s', url => {
    expect(urlMatchesRequestedFhirVersion(url, 'R4')).toBe(false);
  });
});
