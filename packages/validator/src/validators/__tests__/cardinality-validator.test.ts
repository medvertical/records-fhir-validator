import { describe, expect, it } from 'vitest';
import { CardinalityValidator } from '../cardinality-validator';
import type { ElementDefinition } from '../../core/structure-definition-types';

describe('CardinalityValidator', () => {
  it('does not require Observation.dataAbsentReason when value[x] is present', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.dataAbsentReason',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Observation.dataAbsentReason',
      'http://example.org/StructureDefinition/observation',
      {
        resourceType: 'Observation',
        valueQuantity: { value: 7.4, system: 'http://unitsofmeasure.org', code: '[pH]' },
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('does not require Observation.component.dataAbsentReason when each component has a value[x]', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.component.dataAbsentReason',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      [],
      elementDef,
      'Observation.component.dataAbsentReason',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      {
        resourceType: 'Observation',
        component: [
          { valueQuantity: { value: 120, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
          { valueQuantity: { value: 80, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
        ],
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('does not require Observation.dataAbsentReason for component panel observations', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.dataAbsentReason',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Observation.dataAbsentReason',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      {
        resourceType: 'Observation',
        component: [
          { valueQuantity: { value: 120, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
          { valueQuantity: { value: 80, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
        ],
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('does not require Observation.value[x] for component panel observations', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.value[x]',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Observation.value[x]',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      {
        resourceType: 'Observation',
        component: [
          { valueQuantity: { value: 120, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
          { valueQuantity: { value: 80, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
        ],
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('does not require Observation.component for simple observations with value[x]', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.component',
      min: 0,
      max: '*',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Observation.component',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-heart-rate',
      {
        resourceType: 'Observation',
        valueQuantity: { value: 72, system: 'http://unitsofmeasure.org', code: '/min' },
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('does not require Encounter.hospitalization for ambulatory encounters', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Encounter.hospitalization',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Encounter.hospitalization',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter',
      {
        resourceType: 'Encounter',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
        },
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('still requires Encounter.hospitalization for inpatient encounters', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Encounter.hospitalization',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Encounter.hospitalization',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter',
      {
        resourceType: 'Encounter',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IMP',
        },
      },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Encounter.hospitalization',
    }));
  });

  it('does not require Encounter.reasonCode when a typed encounter already has visit context', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Encounter.reasonCode',
      min: 0,
      max: '*',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Encounter.reasonCode',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter',
      {
        resourceType: 'Encounter',
        type: [{
          coding: [{
            system: 'http://snomed.info/sct',
            code: '162673000',
            display: 'General examination of patient',
          }],
        }],
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('still requires Encounter.reasonCode when no encounter reason context is present', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Encounter.reasonCode',
      min: 0,
      max: '*',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Encounter.reasonCode',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter',
      {
        resourceType: 'Encounter',
        status: 'finished',
      },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Encounter.reasonCode',
    }));
  });

  it('does not require Patient.address.period for current addresses', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Patient.address.period',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Patient.address.period',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
      {
        resourceType: 'Patient',
        address: [{ city: 'Boston', state: 'MA', postalCode: '02210' }],
      },
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
    }));
  });

  it('still requires Patient.address.period for old addresses', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Patient.address.period',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Patient.address.period',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
      {
        resourceType: 'Patient',
        address: [{ use: 'old', city: 'Boston', state: 'MA' }],
      },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Patient.address.period',
    }));
  });

  it('still reports Observation.component.dataAbsentReason when a component has no value[x]', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.component.dataAbsentReason',
      min: 0,
      max: '1',
      mustSupport: true,
    } satisfies ElementDefinition;

    const issues = validator.validate(
      [],
      elementDef,
      'Observation.component.dataAbsentReason',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      {
        resourceType: 'Observation',
        component: [
          { code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] } },
        ],
      },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      details: expect.objectContaining({ resourceType: 'Observation' }),
    }));
  });

  it('sets resourceType on structural cardinality issues', () => {
    const validator = new CardinalityValidator();
    const elementDef = {
      path: 'Observation.value[x]',
      min: 1,
      max: '1',
    } satisfies ElementDefinition;

    const issues = validator.validate(
      undefined,
      elementDef,
      'Observation.value[x]',
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-smokingstatus',
      { resourceType: 'Observation' },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-cardinality-min',
      details: expect.objectContaining({ resourceType: 'Observation' }),
    }));
  });
});
