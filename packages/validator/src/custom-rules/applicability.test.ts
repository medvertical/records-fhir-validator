import { describe, expect, it } from 'vitest';
import { evaluateCustomRuleApplicability as evaluate, isCustomRuleReleaseModelCoherent, normalizeCustomRuleSelectedRelease } from './applicability.js';

const canonical = 'https://profiles.example.test/Patient';
const basis = { selectedRelease: 'R4B' as const, profile: { canonical, version: '1.0' } };

describe('custom rule applicability evidence', () => {
  it.each([
    ['R4', 'R4', true], ['R4B', 'R4', true], ['R5', 'R5', true], ['R6', 'R6', true],
    ['R5', 'R4', false], ['R4', 'R5', false], ['R4B', 'R5', false], ['R6', 'R5', false],
    [null, 'R4', true], ['forged', 'R4', false], ['R4', null, false],
  ] as const)('checks selected %s against model %s', (selectedRelease, model, expected) => {
    expect(isCustomRuleReleaseModelCoherent(selectedRelease, model)).toBe(expected);
  });

  it('never executes unrestricted rules under a known incoherent model context', () => {
    expect(evaluate({}, { selectedRelease: 'R5', engineVersion: 'R4' }))
      .toEqual({ status: 'unknown', reason: 'release-model-mismatch' });
  });
  it.each([{}, { fhirVersions: null }, { fhirVersions: [], profilesAny: [] }])('keeps legitimate unrestricted metadata compatible: %j', rule => {
    expect(evaluate(rule, {})).toMatchObject({ status: 'applicable' });
  });

  it.each(['R4', 'R4B', 'R5', 'R6'] as const)('matches only exact selected release %s', selectedRelease => {
    for (const release of ['R4', 'R4B', 'R5', 'R6']) {
      expect(evaluate({ fhirVersions: [release] }, { selectedRelease }).status)
        .toBe(release === selectedRelease ? 'applicable' : 'not-applicable');
    }
  });

  it.each([
    { profilesAny: null }, { profilesAny: 'not-an-array' }, { profilesAny: ['relative'] },
    { profilesAny: [canonical + '|'] }, { profilesAny: [canonical + '|1|2'] },
    { profilesAny: [42] }, { profilesAny: Array(1) }, { fhirVersions: ['4.0.1'] },
    { fhirVersions: ['R4', 'forged'] }, { fhirVersions: false },
  ])('never broadens malformed restrictions: %j', rule => {
    expect(evaluate(rule, basis)).toEqual({ status: 'unknown', reason: 'malformed-restrictions' });
  });

  it('combines restrictions with AND and selector members with OR', () => {
    expect(evaluate({ fhirVersions: ['R4', 'R4B'], profilesAny: ['urn:other', canonical + '|1.0'] }, basis).status).toBe('applicable');
    expect(evaluate({ fhirVersions: ['R5'], profilesAny: [canonical] }, basis).status).toBe('not-applicable');
    expect(evaluate({ fhirVersions: ['R4B'], profilesAny: ['urn:other'] }, basis).status).toBe('not-applicable');
  });

  it('does not infer a selected release or a loaded profile from absence', () => {
    expect(evaluate({ fhirVersions: ['R4'] }, { selectedRelease: null }).reason).toBe('release-basis-unavailable');
    expect(evaluate({ profilesAny: [canonical] }, {}).reason).toBe('profile-basis-unavailable');
  });

  it('matches unversioned selectors but requires exact loaded version for a versioned selector', () => {
    expect(evaluate({ profilesAny: [canonical] }, { profile: { canonical } }).status).toBe('applicable');
    expect(evaluate({ profilesAny: [canonical + '|1.0'] }, { profile: { canonical } }).status).toBe('unknown');
    expect(evaluate({ profilesAny: [canonical + '|2.0'] }, basis).status).toBe('not-applicable');
    expect(evaluate({ profilesAny: [canonical + '|1.0'] }, basis).status).toBe('applicable');
  });

  it('uses actual fallback evidence without excluding an unresolved requested profile', () => {
    const fallback = { ...basis, profileResolutionFallback: true };
    expect(evaluate({ profilesAny: [canonical] }, fallback).status).toBe('applicable');
    expect(evaluate({ profilesAny: [canonical + '|2.0'] }, fallback).status).toBe('not-applicable');
    expect(evaluate({ profilesAny: [canonical + '|2.0', 'urn:unresolved'] }, fallback).status).toBe('unknown');
    expect(evaluate({ profilesAny: ['urn:unresolved'] }, fallback).status).toBe('unknown');
    expect(evaluate({ profilesAny: ['urn:unresolved'] }, basis).status).toBe('not-applicable');
  });

  it.each([['4.0.1', 'R4'], ['4.3.0', 'R4B'], ['5.0.0', 'R5'], ['6.0.0-ballot3', 'R6'], ['4.1.0', null], ['R4Bogus', null]])('normalizes trusted release %s precisely', (input, expected) => {
    expect(normalizeCustomRuleSelectedRelease(input)).toBe(expected);
  });
});
