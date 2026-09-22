import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../types';
import { clearExternalProfiles, storeExternalProfile } from '../sd-loader-external-profile-cache';

function makeState() {
  return {
    cache: new Map<string, StructureDefinition>(),
    externalProfileCacheKeys: new Set<string>(),
    availableProfiles: new Set<string>(),
    profileLoadPromises: new Map<string, Promise<StructureDefinition | null>>(),
  };
}

const profile = (url: string) =>
  ({ resourceType: 'StructureDefinition', url, fhirVersion: '4.0.1' } as unknown as StructureDefinition);

describe('external profile cache', () => {
  it('removes every externally registered profile', () => {
    const state = makeState();
    storeExternalProfile({ url: 'http://example.org/a', profile: profile('http://example.org/a'), ...state });
    storeExternalProfile({ url: 'http://example.org/b', profile: profile('http://example.org/b'), ...state });

    expect(clearExternalProfiles(state)).toBe(2);
    expect(state.cache.size).toBe(0);
    expect(state.externalProfileCacheKeys.size).toBe(0);
    expect(state.availableProfiles.size).toBe(0);
  });

  it('leaves content the host did not register externally', () => {
    const state = makeState();
    // A bundled profile reaches the cache without going through
    // storeExternalProfile, so it carries no external key and must survive.
    state.cache.set('http://hl7.org/fhir/StructureDefinition/Patient:R4', profile('bundled'));
    state.availableProfiles.add('http://hl7.org/fhir/StructureDefinition/Patient');
    storeExternalProfile({ url: 'http://example.org/a', profile: profile('http://example.org/a'), ...state });

    expect(clearExternalProfiles(state)).toBe(1);
    expect(state.cache.has('http://hl7.org/fhir/StructureDefinition/Patient:R4')).toBe(true);
    expect(state.availableProfiles.has('http://hl7.org/fhir/StructureDefinition/Patient')).toBe(true);
  });

  it('recovers the url from a key whose profile url contains a colon', () => {
    const state = makeState();
    storeExternalProfile({ url: 'urn:oid:1.2.3', profile: profile('urn:oid:1.2.3'), ...state });

    clearExternalProfiles(state);
    expect(state.availableProfiles.has('urn:oid:1.2.3')).toBe(false);
  });
});
