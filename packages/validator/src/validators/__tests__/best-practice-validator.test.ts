import { describe, expect, it } from 'vitest';
import { BestPracticeValidator } from '../best-practice-validator';

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
