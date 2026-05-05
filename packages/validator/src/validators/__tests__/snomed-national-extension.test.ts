import { describe, it, expect } from 'vitest';
import { isSnomedNationalExtensionCode } from '../terminology-api-client';

describe('isSnomedNationalExtensionCode', () => {
  it('detects UK Edition SCTIDs (namespace 1000000)', () => {
    expect(isSnomedNationalExtensionCode('196471000000108')).toBe(true);   // UK AllergyIntolerance
    expect(isSnomedNationalExtensionCode('826501000000100')).toBe(true);   // UK List code
    expect(isSnomedNationalExtensionCode('886921000000105')).toBe(true);   // UK List code
    expect(isSnomedNationalExtensionCode('858611000000102')).toBe(true);   // UK ServiceRequest
  });

  it('detects UK Drug Extension SCTIDs (namespace 1000001)', () => {
    expect(isSnomedNationalExtensionCode('17960711000001109')).toBe(true); // UK drug form
  });

  it('detects UK Clinical Extension SCTIDs (namespace 1000237)', () => {
    expect(isSnomedNationalExtensionCode('58571000237106')).toBe(true);    // UK lab code
    expect(isSnomedNationalExtensionCode('16181000237107')).toBe(true);    // UK lab code
  });

  it('returns false for International Edition SCTIDs', () => {
    expect(isSnomedNationalExtensionCode('22298006')).toBe(false);         // Myocardial infarction
    expect(isSnomedNationalExtensionCode('386661006')).toBe(false);        // Fever
    expect(isSnomedNationalExtensionCode('271649006')).toBe(false);        // Systolic BP
    expect(isSnomedNationalExtensionCode('363698007')).toBe(false);        // Finding site
  });

  it('returns false for non-numeric or short strings', () => {
    expect(isSnomedNationalExtensionCode('')).toBe(false);
    expect(isSnomedNationalExtensionCode('abc')).toBe(false);
    expect(isSnomedNationalExtensionCode('12345')).toBe(false);
    expect(isSnomedNationalExtensionCode('123456789')).toBe(false);        // 9 digits — short format
  });
});
