import { describe, expect, it } from 'vitest';
import { displaysEquivalent, displaysEquivalentForCodeInfo } from '../valueset-display-utils';

describe('valueset display equivalence', () => {
  it('ignores punctuation-only display differences', () => {
    expect(displaysEquivalent('Encounter for check up', "Encounter for 'check-up'")).toBe(true);
  });

  it('ignores trailing SNOMED semantic tags', () => {
    expect(displaysEquivalent(
      'Speech and language therapy regime',
      'Speech and language therapy regime (regime/therapy',
    )).toBe(true);
    expect(displaysEquivalent('Severe anxiety (panic)', 'Severe anxiety (panic) (finding')).toBe(true);
  });

  it('keeps clinically different labels distinct', () => {
    expect(displaysEquivalent('Essential hypertension', 'Hypertension')).toBe(false);
    expect(displaysEquivalent('Driver license number', 'Driver License')).toBe(false);
  });

  it('allows identifier type displays without the optional number suffix', () => {
    expect(displaysEquivalentForCodeInfo(
      'Driver license number',
      "Driver's License",
      { system: 'http://terminology.hl7.org/CodeSystem/v2-0203' },
    )).toBe(true);
  });

  it('does not apply identifier display leniency to clinical code systems', () => {
    expect(displaysEquivalentForCodeInfo(
      'Driver license number',
      "Driver's License",
      { system: 'http://snomed.info/sct' },
    )).toBe(false);
  });
});
