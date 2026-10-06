import { describe, expect, it } from 'vitest';
import { sanitizeProfile } from '../sd-loader-profile-sanitizer';
import type { StructureDefinition } from '../structure-definition-types';

const PUBLISHED_VS_1 = '($this as dateTime).toString().length() >= 8';

function vitalSignsProfile(url: string, baseDefinition: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url,
    baseDefinition,
    type: 'Observation',
    snapshot: {
      element: [{
        id: 'Observation.effective[x]',
        path: 'Observation.effective[x]',
        constraint: [{ key: 'vs-1', severity: 'error', human: 'precise to the day', expression: PUBLISHED_VS_1 }],
      }],
    },
  } as unknown as StructureDefinition;
}

function vs1Expression(sd: StructureDefinition): string | undefined {
  return sd.snapshot?.element[0].constraint?.[0].expression;
}

describe('sanitizeProfile', () => {
  it('corrects vs-1 in vital signs profiles like the reference validator, so a period passes', () => {
    const bodytemp = sanitizeProfile(vitalSignsProfile(
      'http://hl7.org/fhir/StructureDefinition/bodytemp',
      'http://hl7.org/fhir/StructureDefinition/vitalsigns',
    ));
    const vitalsigns = sanitizeProfile(vitalSignsProfile(
      'http://hl7.org/fhir/StructureDefinition/vitalsigns',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    ));

    expect(vs1Expression(bodytemp)).toBe('$this is dateTime implies $this.toString().length() >= 10');
    expect(vs1Expression(vitalsigns)).toBe('$this is dateTime implies $this.toString().length() >= 10');
  });

  it('leaves vs-1 of profiles further down the derivation chain as published', () => {
    const derived = sanitizeProfile(vitalSignsProfile(
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs',
    ));

    expect(vs1Expression(derived)).toBe(PUBLISHED_VS_1);
  });
});
