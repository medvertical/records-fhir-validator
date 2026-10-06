import { describe, expect, it } from 'vitest';
import { snapshotTerminologyConfig, terminologyConfigsEqual, resolveCodeSystemVersion } from '../terminology-config-snapshot';
import { mergeTerminologyResolutionConfig } from '../valueset-resolution-config';
import type { TerminologyResolutionConfig } from '../valueset-types';

describe('terminology configuration snapshots', () => {
  it('does not retain mutable auth, server, or policy references', () => {
    const input: TerminologyResolutionConfig = {
      strategy: 'server-first',
      defaultCodeSystemVersions: { 'http://snomed.info/sct': 'own-edition' },
      serverUrl: 'https://tx.example.test/r4',
      auth: { type: 'bearer', token: 'initial-token' },
      servers: [{
        id: 'primary',
        url: 'https://tx.example.test/r4',
        enabled: true,
        fhirVersions: ['R4'],
        preferredSystems: ['http://loinc.org'],
        snomedEditions: ['999000041000000102'],
        authConfig: { type: 'basic', username: 'user', password: 'initial-password' },
      }],
      serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 60,
        maxRemoteCodeSystemValidations: 2,
      },
    };
    const snapshot = snapshotTerminologyConfig(input);

    input.defaultCodeSystemVersions!['http://snomed.info/sct'] = 'another-edition';
    input.auth!.token = 'mutated-token';
    input.servers![0].preferredSystems!.push('http://snomed.info/sct');
    input.servers![0].snomedEditions!.push('900000000000207008');
    input.servers![0].authConfig!.password = 'mutated-password';
    input.serverDelegation!.maxRemoteCodeSystemValidations = 999;

    expect(snapshot.defaultCodeSystemVersions).toEqual({ 'http://snomed.info/sct': 'own-edition' });
    expect(Object.isFrozen(snapshot.defaultCodeSystemVersions)).toBe(true);
    expect(snapshot.auth?.token).toBe('initial-token');
    expect(snapshot.servers?.[0].preferredSystems).toEqual(['http://loinc.org']);
    expect(snapshot.servers?.[0].snomedEditions).toEqual(['999000041000000102']);
    expect(snapshot.servers?.[0].authConfig?.password).toBe('initial-password');
    expect(snapshot.serverDelegation?.maxRemoteCodeSystemValidations).toBe(2);
  });

  it('canonicalizes map order, clears omitted defaults and honors an explicit requested edition', () => {
    const first = snapshotTerminologyConfig({ strategy: 'local-only', defaultCodeSystemVersions: {
      'http://snomed.info/sct': 'edition-1', 'http://loinc.org': '2.82',
    } });
    const reordered = snapshotTerminologyConfig({ strategy: 'local-only', defaultCodeSystemVersions: {
      'http://loinc.org': '2.82', 'http://snomed.info/sct': 'edition-1',
    } });
    expect(terminologyConfigsEqual(first, reordered)).toBe(true);
    expect(resolveCodeSystemVersion(first, 'http://snomed.info/sct')).toBe('edition-1');
    expect(resolveCodeSystemVersion(first, 'http://snomed.info/sct', 'explicit-edition')).toBe('explicit-edition');
    expect(resolveCodeSystemVersion(first, 'http://other.example')).toBeUndefined();
    expect(mergeTerminologyResolutionConfig(first, { strategy: 'local-only' }).defaultCodeSystemVersions).toBeUndefined();
  });

  it.each([
    { 'relative': 'edition' }, { 'http://example.test': '' }, { 'http://example.test': ' edition' },
    { 'http://example.test|x': 'edition' }, { 'http://example.test': 'edition|other' },
    Object.create({ 'http://example.test': 'inherited-edition' }),
    Object.defineProperty({}, 'http://example.test', { get: () => { throw new Error('must not read'); } }),
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`http://example.test/${index}`, 'edition'])),
  ])('refuses unsafe default maps without executing an accessor', defaults => {
    expect(() => snapshotTerminologyConfig({ strategy: 'local-only', defaultCodeSystemVersions: defaults })).toThrow(/CodeSystem default/);
  });

});
