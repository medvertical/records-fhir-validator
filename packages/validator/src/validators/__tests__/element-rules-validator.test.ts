import { describe, expect, it } from 'vitest';
import { ElementRulesValidator } from '../element-rules-validator';
import type { ElementDefinition } from '../../core/structure-definition-types';

describe('ElementRulesValidator', () => {
  const validator = new ElementRulesValidator();

  it('reports minValueDate violations', () => {
    const elementDef = {
      path: 'Patient.birthDate',
      minValueDate: '2020-01-01',
    } as ElementDefinition;

    const issues = validator.validate('2019-12-31', elementDef, 'Patient.birthDate');

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('profile-min-value-violation');
  });

  it('reports maxValueDuration violations for duration values', () => {
    const elementDef = {
      path: 'Observation.value[x]',
      maxValueDuration: { value: 5, system: 'http://unitsofmeasure.org', code: 'd' },
    } as ElementDefinition;

    const issues = validator.validate(
      { value: 7, system: 'http://unitsofmeasure.org', code: 'd' },
      elementDef,
      'Observation.valueDuration'
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('profile-max-value-violation');
  });

  it('reports minValueDuration violations for temporal values relative to now', () => {
    const elementDef = {
      path: 'Patient.birthDate',
      minValueDuration: { value: 100, system: 'http://unitsofmeasure.org', code: 'a' },
    } as ElementDefinition;

    const issues = validator.validate('1850-01-01', elementDef, 'Patient.birthDate');

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('profile-min-value-duration-violation');
  });

  it('allows values on minValue and maxValue boundaries', () => {
    const elementDef = {
      path: 'Observation.value[x]',
      minValueQuantity: { value: 3, system: 'http://unitsofmeasure.org', code: 'mg' },
      maxValueQuantity: { value: 3, system: 'http://unitsofmeasure.org', code: 'mg' },
    } as ElementDefinition;

    const issues = validator.validate(
      { value: 3, system: 'http://unitsofmeasure.org', code: 'mg' },
      elementDef,
      'Observation.valueQuantity'
    );

    expect(issues).toHaveLength(0);
  });

  it('compares compatible UCUM mass quantities across units', () => {
    const elementDef = {
      path: 'Observation.value[x]',
      minValueQuantity: { value: 1, system: 'http://unitsofmeasure.org', code: 'kg' },
      maxValueQuantity: { value: 2, system: 'http://unitsofmeasure.org', code: 'kg' },
    } as ElementDefinition;

    const validIssues = validator.validate(
      { value: 1500, system: 'http://unitsofmeasure.org', code: 'g' },
      elementDef,
      'Observation.valueQuantity'
    );
    const lowIssues = validator.validate(
      { value: 500, system: 'http://unitsofmeasure.org', code: 'g' },
      elementDef,
      'Observation.valueQuantity'
    );
    const highIssues = validator.validate(
      { value: 2500, system: 'http://unitsofmeasure.org', code: 'g' },
      elementDef,
      'Observation.valueQuantity'
    );

    expect(validIssues).toHaveLength(0);
    expect(lowIssues[0].code).toBe('profile-min-value-violation');
    expect(highIssues[0].code).toBe('profile-max-value-violation');
  });

  it('enforces nested object pattern properties', () => {
    const elementDef = {
      path: 'Observation.code',
      patternCodeableConcept: {
        coding: [{ system: 'http://loinc.org', code: '8310-5' }],
      },
    } as ElementDefinition;

    const issues = validator.validate(
      { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
      elementDef,
      'Observation.code'
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('profile-pattern-mismatch');
  });

  it('allows pattern arrays to match a subset of actual array entries', () => {
    const elementDef = {
      path: 'Observation.code',
      patternCodeableConcept: {
        coding: [{ system: 'http://loinc.org', code: '8310-5' }],
      },
    } as ElementDefinition;

    const issues = validator.validate(
      {
        coding: [
          { system: 'http://snomed.info/sct', code: '999' },
          { system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' },
        ],
      },
      elementDef,
      'Observation.code'
    );

    expect(issues).toHaveLength(0);
  });
});
