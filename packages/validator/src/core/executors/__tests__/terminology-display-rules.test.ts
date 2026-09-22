import { describe, expect, it } from 'vitest';
import {
  anyDisplayEquivalent,
  extractAcceptedDisplays,
  extractExpectedDisplay,
  uniqueAcceptedDisplays,
  validateKnownLoincDisplays,
} from '../terminology-display-rules';

function observationWithDisplay(
  display: string,
  code = '8716-3',
  language?: string,
): Record<string, unknown> {
  return {
    resourceType: 'Observation',
    ...(language ? { language } : {}),
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code,
          display,
        },
      ],
    },
  };
}

function medicationWithSnomedDisplay(display: string, code = '322236009'): Record<string, unknown> {
  return {
    resourceType: 'Medication',
    code: { coding: [{ system: 'http://snomed.info/sct', code, display }] },
  };
}

describe('terminology display rule helpers', () => {
  it('retains result grades in remote designations and deduplication', () => {
    const displays = ['Urine leukocyte test = +', 'Urine leukocyte test = ++'];
    expect(anyDisplayEquivalent(displays, 'Urine leukocyte test')).toBe(false);
    expect(anyDisplayEquivalent(displays, 'Urine leukocyte test +')).toBe(true);
    expect(uniqueAcceptedDisplays(displays)).toEqual(displays);
  });

  it('extracts a single accepted display', () => {
    expect(extractAcceptedDisplays("Wrong Display Name 'BMI'. Valid display is 'Body mass index (BMI) [Ratio]'"))
      .toEqual(['Body mass index (BMI) [Ratio]']);
  });

  it('extracts a single accepted display with terminology server language suffix', () => {
    expect(extractAcceptedDisplays(
      "Wrong Display Name '0.4 ML Enoxaparin sodium 100 MG/ML Prefilled Syringe' for http://www.nlm.nih.gov/research/umls/rxnorm#854235. " +
      "Valid display is 'enoxaparin sodium 40 MG in 0.4 ML Prefilled Syringe' (en) (for the language(s) '--')",
    )).toEqual(['enoxaparin sodium 40 MG in 0.4 ML Prefilled Syringe']);
  });

  it('extracts choices that contain apostrophes and parentheses', () => {
    const message =
      "Wrong Display Name 'Platelet mean volume [Entitic volume] in Blood by Automated count' for http://loinc.org#32623-1. " +
      "Valid display is one of 3 choices: " +
      "'Volume moyen plaquettaire [Volume d'entité] Sang ; Numérique ; Comptage automate' (fr-FR) or " +
      "'Platelet [Entitic mean volume] in Blood by Automated count' (en) or " +
      "'Mittleres Thrombozytenvolumen [Entitisches mittleres Volumen] in Blut mittels automatisierter Zählung' (de-DE) " +
      "(for the language(s) '--')";

    expect(extractAcceptedDisplays(message)).toEqual([
      "Volume moyen plaquettaire [Volume d'entité] Sang ; Numérique ; Comptage automate",
      'Platelet [Entitic mean volume] in Blood by Automated count',
      'Mittleres Thrombozytenvolumen [Entitisches mittleres Volumen] in Blut mittels automatisierter Zählung',
    ]);
    expect(extractExpectedDisplay(message)).toBe("Volume moyen plaquettaire [Volume d'entité] Sang ; Numérique ; Comptage automate");
  });

  it('deduplicates displays by normalized clinical display text', () => {
    expect(uniqueAcceptedDisplays([
      'Essential hypertension',
      'Essential hypertension',
      'Essential hypertension (disorder)',
      'Primary hypertension',
    ])).toEqual([
      'Essential hypertension',
      'Primary hypertension',
    ]);
  });
});

describe('validateKnownLoincDisplays', () => {
  it('leaves SNOMED designation membership to the edition-aware terminology validator', () => {
    expect(validateKnownLoincDisplays({
      resourceType: 'Medication',
      code: { coding: [{
        system: 'http://snomed.info/sct', code: '322236009',
        display: 'Acetaminophen 500 mg oral tablet',
      }] },
    })).toEqual([]);
  });

  it('does not reject a versioned Coding using the unversioned display table', () => {
    expect(validateKnownLoincDisplays({
      resourceType: 'Observation',
      code: { coding: [{
        system: 'http://loinc.org', code: '8716-3',
        version: '2.10', display: 'Version-specific designation',
      }] },
    })).toEqual([]);
  });

  it('accepts the exact Long Common Name', () => {
    expect(validateKnownLoincDisplays(observationWithDisplay('Vital signs note'))).toEqual([]);
  });

  it('accepts any valid LOINC designation, not only the Long Common Name', () => {
    expect(validateKnownLoincDisplays(observationWithDisplay('Vital signs'))).toEqual([]);
  });

  it('accepts designations case-insensitively', () => {
    expect(validateKnownLoincDisplays(observationWithDisplay('VITAL SIGNS'))).toEqual([]);
  });

  it('flags a display matching no accepted designation as an error (Java parity)', () => {
    const issues = validateKnownLoincDisplays(observationWithDisplay('Blood pressure'));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      severity: 'error',
      code: 'terminology-display-mismatch',
      path: 'Observation.code.coding[0].display',
    }));
  });

  it('leaves an unknown SNOMED designation to the edition-aware resolver', () => {
    expect(validateKnownLoincDisplays(
      medicationWithSnomedDisplay('Something else entirely'),
    )).toEqual([]);
  });

  it('accepts the SNOMED synonym the curated entry had been missing', () => {
    expect(validateKnownLoincDisplays(
      medicationWithSnomedDisplay('Acetaminophen 500 mg oral tablet'),
    )).toEqual([]);
  });

  // LOINC 2.78 renamed document-section LCNs from '<X> Narrative' to
  // '<X> note'; ballot IGs built against older releases still carry the
  // former names, which stay valid designations (tx.fhir.org LOINC 2.77).
  it('accepts former document-section Long Common Names', () => {
    expect(validateKnownLoincDisplays(
      observationWithDisplay('Social history Narrative', '29762-2'),
    )).toEqual([]);
    expect(validateKnownLoincDisplays(
      observationWithDisplay('Relevant diagnostic tests/laboratory data Narrative', '30954-2'),
    )).toEqual([]);
  });

  it('accepts former German designations for German-language resources', () => {
    expect(validateKnownLoincDisplays(
      observationWithDisplay('Sozialanamnese - Freitext', '29762-2', 'de-DE'),
    )).toEqual([]);
  });
});
