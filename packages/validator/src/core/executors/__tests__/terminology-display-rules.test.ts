import { describe, expect, it } from 'vitest';
import {
  extractAcceptedDisplays,
  extractExpectedDisplay,
  uniqueAcceptedDisplays,
} from '../terminology-display-rules';

describe('terminology display rule helpers', () => {
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
