import { describe, expect, it } from 'vitest';
import { BestPracticeValidator, validateBestPractices } from '../best-practice-validator';

const validator = new BestPracticeValidator();

describe('BestPracticeValidator Observation rules', () => {
  it('keeps HAPI-like Observation performer advice without generic method or interpretation noise', () => {
    const issues = validator.validate({
      resourceType: 'Observation',
      resource: {
        resourceType: 'Observation',
        id: 'body-height',
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
          }],
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8302-2',
            display: 'Body Height',
          }],
        },
        valueQuantity: {
          value: 172.5,
          unit: 'cm',
          system: 'http://unitsofmeasure.org',
          code: 'cm',
        },
        effectiveDateTime: '2015-09-22T09:43:36Z',
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'best-practice-missing-performer',
      message: 'All Observations should have a `performer`',
      path: 'Observation.performer',
      resourceType: 'Observation',
    }));
    expect(issues.find(issue => issue.code === 'best-practice-observation-method')).toBeUndefined();
    expect(issues.find(issue => issue.code === 'best-practice-observation-interpretation')).toBeUndefined();
    expect(issues.find(issue => issue.code === 'best-practice-missing-effective')).toBeUndefined();
  });

  it('does not emit performer advice when an Observation has a performer', () => {
    const issues = validator.validate({
      resourceType: 'Observation',
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: { text: 'Example' },
        effectiveDateTime: '2026-05-24T10:00:00Z',
        performer: [{ reference: 'Practitioner/p1' }],
      },
    });

    expect(issues.find(issue => issue.code === 'best-practice-missing-performer')).toBeUndefined();
  });
});

describe('BestPracticeValidator Patient rules', () => {
  it('emits Patient narrative advice with resourceType for central dedupe', () => {
    const issues = validator.validate({
      resourceType: 'Patient',
      resource: {
        resourceType: 'Patient',
        id: 'p1',
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'dom-6',
      path: 'Patient.text',
      resourceType: 'Patient',
    }));
  });
});

describe('validateBestPractices settings mapping', () => {
  const narrativelessPatient = {
    resourceType: 'Patient',
    id: 'p1',
    identifier: [{ system: 'urn:example', value: '123' }],
    name: [{ family: 'Tester' }],
  };

  it('keeps best practices informational without settings', () => {
    const issues = validateBestPractices(validator, {
      resourceType: 'Patient',
      resource: narrativelessPatient,
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'dom-6',
      severity: 'information',
    }));
  });

  it('escalates to warning when bestPracticeSeverity is warning', () => {
    const issues = validateBestPractices(
      validator,
      { resourceType: 'Patient', resource: narrativelessPatient },
      { bestPracticeSeverity: 'warning' },
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(issue => issue.severity === 'warning')).toBe(true);
  });

  it('suppresses all findings when enableBestPracticeChecks is false', () => {
    const issues = validateBestPractices(
      validator,
      { resourceType: 'Patient', resource: narrativelessPatient },
      { enableBestPracticeChecks: false, bestPracticeSeverity: 'warning' },
    );

    expect(issues).toHaveLength(0);
  });
});
