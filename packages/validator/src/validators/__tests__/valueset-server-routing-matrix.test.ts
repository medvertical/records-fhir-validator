import { describe, expect, it } from 'vitest';

import { DEFAULT_TERMINOLOGY_SERVERS } from '@records-fhir/validation-types';
import {
  extractSnomedEditionIdentifier,
  getScopedExpansionCacheKey,
  hasTerminologyServer,
  resolveTerminologyServerForSystem,
} from '../valueset-server-routing';

describe('terminology server routing matrix', () => {
  it('keeps public Snowstorm opt-in while retaining an enabled R4 SNOMED-capable primary', () => {
    expect(DEFAULT_TERMINOLOGY_SERVERS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'csiro-ontoserver-r4',
        enabled: true,
        fhirVersions: ['R4'],
        snomedEditions: ['900000000000207008'],
      }),
      expect.objectContaining({
        id: 'snowstorm-snomedtools',
        enabled: false,
        preferredSystems: ['http://snomed.info/sct'],
      }),
    ]));
  });

  it('routes the International SNOMED edition to the enabled CSIRO preset', () => {
    expect(resolveTerminologyServerForSystem(
      { strategy: 'server-first', servers: DEFAULT_TERMINOLOGY_SERVERS },
      'http://snomed.info/sct',
      'http://snomed.info/sct/900000000000207008/version/20230731',
      'R4',
    )).toMatchObject({
      url: 'https://r4.ontoserver.csiro.au/fhir', authoritativeSnomedEdition: true,
    });
  });

  it('keeps general-purpose presets eligible for other systems after declaring SNOMED editions', () => {
    expect(resolveTerminologyServerForSystem(
      { strategy: 'server-first', serverUrl: 'https://tx.fhir.org/r5', servers: DEFAULT_TERMINOLOGY_SERVERS },
      'http://loinc.org', undefined, 'R4',
    )).toMatchObject({ url: 'https://r4.ontoserver.csiro.au/fhir' });
  });

  it('skips an open SNOMED specialist circuit and falls back to the generic server', () => {
    const config = {
      strategy: 'server-first' as const,
      serverUrl: 'https://generic.example/fhir',
      servers: [{
        id: 'snowstorm',
        url: 'https://snowstorm.example/fhir',
        enabled: true,
        circuitOpen: true,
        fhirVersions: ['R4' as const],
        preferredSystems: ['http://snomed.info/sct'],
      }],
    };

    expect(resolveTerminologyServerForSystem(config, 'http://snomed.info/sct')).toBeUndefined();
  });

  it('routes a versioned SNOMED coding to its declared national edition', () => {
    const config = {
      strategy: 'server-first' as const,
      serverUrl: 'https://generic.example/fhir',
      servers: [
        {
          id: 'generic-snomed',
          url: 'https://generic-snomed.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
          preferredSystems: ['http://snomed.info/sct'],
        },
        {
          id: 'uk-edition',
          url: 'https://uk-snomed.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
          preferredSystems: ['http://snomed.info/sct'],
          snomedEditions: ['999000041000000102'],
        },
      ],
    };

    expect(resolveTerminologyServerForSystem(
      config,
      'http://snomed.info/sct',
      'http://snomed.info/sct/999000041000000102/version/20250701',
    )).toEqual({
      url: 'https://uk-snomed.example/fhir',
      auth: undefined,
      authoritativeSnomedEdition: true,
    });
    expect(resolveTerminologyServerForSystem(config, 'http://snomed.info/sct'))
      .toEqual({ url: 'https://generic-snomed.example/fhir', auth: undefined });
  });

  it('routes a SNOMED edition only to a server for the requested FHIR release', () => {
    const config = {
      strategy: 'server-first' as const,
      serverUrl: 'https://r4-snomed.example/fhir',
      servers: [
        {
          id: 'uk-r4',
          url: 'https://r4-snomed.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
          snomedEditions: ['999000041000000102'],
        },
        {
          id: 'uk-r5',
          url: 'https://r5-snomed.example/fhir',
          enabled: true,
          fhirVersions: ['R5' as const],
          snomedEditions: ['999000041000000102'],
        },
      ],
    };
    const version = 'http://snomed.info/sct/999000041000000102/version/20250701';

    expect(resolveTerminologyServerForSystem(config, 'http://snomed.info/sct', version, 'R5'))
      .toEqual({
        url: 'https://r5-snomed.example/fhir',
        auth: undefined,
        authoritativeSnomedEdition: true,
      });
    expect(resolveTerminologyServerForSystem(config, 'http://snomed.info/sct', version, 'R6'))
      .toBeUndefined();
  });

  it('does not route an unmatched SNOMED edition to a preferred or generic server', () => {
    const config = {
      strategy: 'server-first' as const,
      serverUrl: 'https://generic-snomed.example/fhir',
      servers: [
        {
          id: 'generic-snomed',
          url: 'https://generic-snomed.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
          preferredSystems: ['http://snomed.info/sct'],
        },
        {
          id: 'generic',
          url: 'https://generic.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
        },
      ],
    };

    expect(resolveTerminologyServerForSystem(
      config,
      'http://snomed.info/sct',
      'http://snomed.info/sct/999000041000000102/version/20250701',
      'R4',
    )).toBeUndefined();
  });

  it('falls back to the first release-compatible generic server', () => {
    const config = {
      strategy: 'server-first' as const,
      serverUrl: 'https://r4.example/fhir',
      servers: [
        {
          id: 'r4-default',
          url: 'https://r4.example/fhir',
          enabled: true,
          fhirVersions: ['R4' as const],
        },
        {
          id: 'r5-loinc-specialist',
          url: 'https://r5-loinc.example/fhir',
          enabled: true,
          fhirVersions: ['R5' as const],
          preferredSystems: ['http://loinc.org'],
        },
        {
          id: 'r5-generic',
          url: 'https://r5.example/fhir',
          enabled: true,
          fhirVersions: ['R5' as const],
        },
      ],
    };

    const override = resolveTerminologyServerForSystem(
      config,
      'http://example.org/CodeSystem/example',
      undefined,
      'R5',
    );

    expect(override).toEqual({ url: 'https://r5.example/fhir', auth: undefined });
    expect(hasTerminologyServer(config, override, 'R5')).toBe(true);
    expect(hasTerminologyServer(config, undefined, 'R5')).toBe(true);
  });

  it('normalizes configured SNOMED module IDs and edition URIs', () => {
    expect(extractSnomedEditionIdentifier('999000041000000102'))
      .toBe('999000041000000102');
    expect(extractSnomedEditionIdentifier(
      'http://snomed.info/sct/999000041000000102/version/20250701',
    )).toBe('999000041000000102');
    expect(extractSnomedEditionIdentifier('http://example.org/not-snomed')).toBeUndefined();
  });

  it('isolates expansion caches by FHIR version and endpoint configuration', () => {
    const base = {
      strategy: 'server-first' as const,
      serverUrl: 'https://a.example/fhir',
    };
    expect(getScopedExpansionCacheKey('http://example.org/ValueSet/x', base, 'R4'))
      .not.toBe(getScopedExpansionCacheKey(
        'http://example.org/ValueSet/x',
        { ...base, serverUrl: 'https://b.example/fhir' },
        'R4',
      ));
    expect(getScopedExpansionCacheKey('http://example.org/ValueSet/x', base, 'R4'))
      .not.toBe(getScopedExpansionCacheKey('http://example.org/ValueSet/x', base, 'R5'));
  });

  it('isolates expansion caches when remote expansion policy changes', () => {
    const base = {
      strategy: 'server-first' as const,
      serverUrl: 'https://a.example/fhir',
      serverDelegation: {
        cacheResults: true,
        cacheTTLSeconds: 60,
        expandValueSets: true,
        validateCodes: true,
      },
    };

    expect(getScopedExpansionCacheKey('http://example.org/ValueSet/x', base, 'R4'))
      .not.toBe(getScopedExpansionCacheKey(
        'http://example.org/ValueSet/x',
        {
          ...base,
          serverDelegation: { ...base.serverDelegation, expandValueSets: false },
        },
        'R4',
      ));
  });

  it('isolates expansion caches when a server FHIR release route changes', () => {
    const server = {
      id: 'tx',
      url: 'https://tx.example/fhir',
      enabled: true,
      fhirVersions: ['R4' as const],
    };
    const r4 = {
      strategy: 'server-first' as const,
      serverUrl: server.url,
      servers: [server],
    };
    const r5 = {
      ...r4,
      servers: [{ ...server, fhirVersions: ['R5' as const] }],
    };

    expect(getScopedExpansionCacheKey('http://example.org/ValueSet/x', r4, 'R4'))
      .not.toBe(getScopedExpansionCacheKey('http://example.org/ValueSet/x', r5, 'R4'));
  });

  it('isolates expansion caches by credential scope without exposing credentials', () => {
    const base = {
      auth: { type: 'bearer' as const, token: 'tenant-a-secret' },
      serverUrl: 'https://shared.example/fhir',
      strategy: 'server-first' as const,
    };
    const firstKey = getScopedExpansionCacheKey('http://example.org/ValueSet/x', base, 'R4');
    const secondKey = getScopedExpansionCacheKey(
      'http://example.org/ValueSet/x',
      { ...base, auth: { type: 'bearer', token: 'tenant-b-secret' } },
      'R4',
    );

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).not.toContain('tenant-a-secret');
    expect(secondKey).not.toContain('tenant-b-secret');
  });
});
