// Unit tests for evaluateTrailingMemberOf — the sync fallback for boolean
// `<prefix>.memberOf(VS)` constraints (fhirpath.js memberOf is async-only).
import { describe, it, expect } from 'vitest';
import { evaluateTrailingMemberOf } from '../fhirpath-memberof-precheck';

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
});
