import { describe, expect, it } from 'vitest';
import { displaysEquivalent, displaysEquivalentForCodeInfo } from '../valueset-display-utils';

describe('valueset display equivalence', () => {
  it.each([
    ['Urine leukocyte test = +', 'Urine leukocyte test'],
    ['Urine leukocyte test +', 'Urine leukocyte test ++'],
    ['Urine test = -', 'Urine test'],
    ['Concentration >= 5', 'Concentration > 5'],
    ['Temperature -5', 'Temperature 5'],
  ])('preserves the meaning of %s versus %s', (expected, actual) => {
    expect(displaysEquivalent(expected, actual)).toBe(false);
    expect(displaysEquivalentForCodeInfo(expected, actual, { system: 'http://loinc.org' })).toBe(false);
  });

  it('accepts equivalent typography for grades and comparisons', () => {
    expect(displaysEquivalent('Urine test = +', 'Urine test +')).toBe(true);
    expect(displaysEquivalent('Concentration >= 5', 'Concentration ≥5')).toBe(true);
  });

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

  it('accepts a SNOMED specimen name with its semantic tag without hiding different specimens', () => {
    const coding = { system: 'http://snomed.info/sct', code: '258603007' };
    expect(displaysEquivalentForCodeInfo('Respiratory specimen', 'Respiratory specimen (specimen)', coding)).toBe(true);
    expect(displaysEquivalentForCodeInfo('Respiratory specimen', 'Urine specimen (specimen)', coding)).toBe(false);
    expect(displaysEquivalentForCodeInfo('Respiratory specimen', 'Respiratory specimen (specimen)',
      { system: 'https://example.org/codes', code: 'example' })).toBe(false);
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

  it('accepts the SNOMED preferred display Moderate when a server returns Midgrade', () => {
    expect(displaysEquivalentForCodeInfo(
      'Midgrade',
      'moderate',
      { system: 'http://snomed.info/sct', code: '6736007' },
    )).toBe(true);
    expect(displaysEquivalentForCodeInfo(
      'Midgrade',
      'mild to moderate',
      { system: 'http://snomed.info/sct', code: '6736007' },
    )).toBe(false);
  });

  it('does not silently remove semantic text from HL7 v2 displays', () => {
    expect(displaysEquivalentForCodeInfo(
      'Routine appointment - default if not valued',
      'Routine appointment',
      { system: 'http://terminology.hl7.org/CodeSystem/v2-0276' },
    )).toBe(false);
  });

  it('allows concise LOINC common display names', () => {
    expect(displaysEquivalentForCodeInfo(
      'Blood pressure systolic and diastolic',
      'Blood Pressure',
      { system: 'http://loinc.org', code: '55284-4' },
    )).toBe(true);
    expect(displaysEquivalentForCodeInfo(
      'Cholesterol in HDL [Mass/volume] in Serum or Plasma',
      'High Density Lipoprotein Cholesterol',
      { system: 'http://loinc.org', code: '2085-9' },
    )).toBe(true);
    expect(displaysEquivalentForCodeInfo(
      'Tobacco smoking status',
      'Tobacco smoking status NHIS',
      { system: 'http://loinc.org', code: '72166-2' },
    )).toBe(true);
    expect(displaysEquivalentForCodeInfo(
      'Creatinine [Mass/volume] in Blood',
      'Creatinine',
      { system: 'http://loinc.org', code: '38483-4' },
    )).toBe(true);
    expect(displaysEquivalentForCodeInfo(
      'Glomerular filtration rate [Volume Rate/Area] in Serum or Plasma by Creatinine-based formula (MDRD)/1.73 sq M',
      'Estimated Glomerular Filtration Rate',
      { system: 'http://loinc.org', code: '33914-3' },
    )).toBe(true);
  });

  it('does not allow vague one-word LOINC labels for specific multi-token concepts', () => {
    expect(displaysEquivalentForCodeInfo(
      'Blood pressure systolic and diastolic',
      'Blood',
      { system: 'http://loinc.org', code: '55284-4' },
    )).toBe(false);
  });
});
