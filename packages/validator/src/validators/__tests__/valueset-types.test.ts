import { describe, expect, it } from 'vitest';
import { isExternalCodeSystem } from '../valueset-types';

describe('valueset-types external CodeSystems', () => {
  it('does not directly validate ICD membership against generic public terminology servers', () => {
    expect(isExternalCodeSystem('http://hl7.org/fhir/sid/icd-10')).toBe(false);
    expect(isExternalCodeSystem('http://hl7.org/fhir/sid/icd-10-cm')).toBe(false);
    expect(isExternalCodeSystem('http://hl7.org/fhir/sid/icd-9-cm')).toBe(false);
  });

  it('still delegates large externally resolvable terminology systems', () => {
    expect(isExternalCodeSystem('http://loinc.org')).toBe(true);
    expect(isExternalCodeSystem('http://snomed.info/sct')).toBe(true);
    expect(isExternalCodeSystem('http://www.nlm.nih.gov/research/umls/rxnorm')).toBe(true);
  });
});
