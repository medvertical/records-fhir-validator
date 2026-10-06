import { describe, expect, it } from 'vitest';
import { isKnownCrossVersionExtensionUrl, unsupportedCrossVersionRelease } from '../extension-xver-urls';

describe('cross-version extension URLs', () => {
  it('accepts a plain cross-version extension for any covered version', () => {
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/5.0/StructureDefinition/extension-DiagnosticReport.composition',
      'extension',
    )).toBe(true);
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/3.0/StructureDefinition/extension-Patient.animal.species',
      'extension',
    )).toBe(true);
  });

  it('accepts a modifier cross-version extension whose element is a modifier', () => {
    // QI-Core negation: DeviceRequest.doNotPerform is flagged modifier in
    // xver-paths-5.0; the Java validator resolves it without any finding.
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/5.0/StructureDefinition/extension-DeviceRequest.doNotPerform',
      'modifierExtension',
    )).toBe(true);
  });

  it('normalises choice markers when checking modifier elements', () => {
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/3.0/StructureDefinition/extension-Patient.deceased',
      'modifierExtension',
    )).toBe(true);
  });

  it('rejects a modifier cross-version extension for a non-modifier element', () => {
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/5.0/StructureDefinition/extension-Patient.maritalStatus',
      'modifierExtension',
    )).toBe(false);
  });

  it('ignores URLs outside the cross-version pattern', () => {
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
      'extension',
    )).toBe(false);
    expect(isKnownCrossVersionExtensionUrl(
      'http://hl7.org/fhir/9.9/StructureDefinition/extension-Patient.gender',
      'extension',
    )).toBe(false);
  });

  it('names the release of a cross-version URL the dataset does not cover', () => {
    expect(unsupportedCrossVersionRelease('http://hl7.org/fhir/6.0/StructureDefinition/extension-Person.deceased[x]')).toBe('6.0');
    expect(unsupportedCrossVersionRelease('http://hl7.org/fhir/4.3/StructureDefinition/extension-Patient.gender')).toBe('4.3');
    expect(unsupportedCrossVersionRelease('http://hl7.org/fhir/5.0/StructureDefinition/extension-Patient.gender')).toBeUndefined();
    expect(unsupportedCrossVersionRelease('https://hl7.org/fhir/6.0/StructureDefinition/extension-Patient.gender')).toBeUndefined();
    expect(unsupportedCrossVersionRelease('http://hl7.org/fhir/6.0/StructureDefinition/patient-birthPlace')).toBeUndefined();
  });
});
