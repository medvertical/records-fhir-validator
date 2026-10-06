// Unit tests for evaluateTrailingMemberOf — the sync fallback for boolean
// `<prefix>.memberOf(VS)` constraints (fhirpath.js memberOf is async-only).
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateOptionalMemberOfUnion,
  evaluateSimpleMemberOfExists,
  evaluateTrailingMemberOf,
} from '../fhirpath-memberof-precheck';
import { ValueSetCache } from '../valueset-cache';

describe('evaluateTrailingMemberOf edge cases', () => {
  it('returns null for non-memberOf expressions', () => {
    expect(evaluateTrailingMemberOf("name.exists()", { resourceType: 'Patient' })).toBeNull();
  });
  it('returns true when no values selected (vacuous)', () => {
    const r = { resourceType: 'Patient', address: [] };
    expect(evaluateTrailingMemberOf("address.where(country = 'XX').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')", r)).toBe(true);
  });
  it('returns null (undeterminable) for unknown ValueSet not in ISO/cache', () => {
    const r = { resourceType: 'Patient', address: [{ country: 'XX' }] };
    expect(evaluateTrailingMemberOf("address.country.memberOf('http://example.org/ValueSet/unknown')", r)).toBeNull();
  });
  it('uses only the cache supplied by the owning validator', () => {
    const url = 'http://example.org/ValueSet/isolated';
    const firstCache = new ValueSetCache();
    const secondCache = new ValueSetCache();
    firstCache.setExpandedCodes(url, new Set(['X']));
    const resource = { resourceType: 'Patient', address: [{ country: 'X' }] };
    const expression = `address.country.memberOf('${url}')`;

    expect(evaluateTrailingMemberOf(expression, resource, 'R4', firstCache)).toBe(true);
    expect(evaluateTrailingMemberOf(expression, resource, 'R4', secondCache)).toBeNull();
  });
  it('returns false for invalid ISO code, true for valid', () => {
    const bad = { resourceType: 'Patient', address: [{ country: 'XX' }] };
    const good = { resourceType: 'Patient', address: [{ country: 'DE' }] };
    expect(evaluateTrailingMemberOf("address.country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')", bad)).toBe(false);
    expect(evaluateTrailingMemberOf("address.country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')", good)).toBe(true);
  });
  it('returns null when prefix uses an unsupported sync function (graceful fallback)', () => {
    const r = { resourceType: 'Patient', address: [{ country: 'XX' }] };
    // resolve() is async-only — prefix eval throws → null
    expect(evaluateTrailingMemberOf("address.resolve().country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')", r)).toBeNull();
  });

  it('treats malformed scalar resources as an empty selection', () => {
    expect(evaluateTrailingMemberOf(
      "address.country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')",
      42,
    )).toBe(true);
  });
});

describe('other memberOf prechecks', () => {
  it('continues through cyclic arrays and finds a later accepted code', async () => {
    const cyclicCodings: unknown[] = [];
    cyclicCodings.push(cyclicCodings, { code: 'DE' });
    const loader = {
      loadValueSet: vi.fn().mockResolvedValue(['DE']),
      hasIncompleteExpansion: vi.fn().mockResolvedValue(false),
    };

    await expect(evaluateSimpleMemberOfExists(
      "where(codeable.coding.code.memberOf('http://example.org/ValueSet/countries')).exists()",
      { codeable: { coding: cyclicCodings } },
      'Observation',
      loader,
    )).resolves.toBe(true);
  });

  it('handles malformed optional-union contexts without throwing', () => {
    const expression =
      "country.empty() or (country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2'))";

    expect(evaluateOptionalMemberOfUnion(expression, null)).toBe(true);
    expect(evaluateOptionalMemberOfUnion(expression, { country: 42 })).toBeNull();
  });
});
