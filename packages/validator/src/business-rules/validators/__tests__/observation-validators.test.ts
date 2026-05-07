import { describe, expect, it } from 'vitest';
import { validateObservationStatusValueConsistency } from '../observation-validators';

describe('validateObservationStatusValueConsistency', () => {
  it('does not warn for final panel observations with component values', async () => {
    const issues = await validateObservationStatusValueConsistency({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '85354-9' }],
      },
      component: [
        {
          code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
          valueQuantity: { value: 112, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
        },
        {
          code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
          valueQuantity: { value: 68, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
        },
      ],
    }, 'Observation');

    expect(issues).toEqual([]);
  });

  it('does not warn when a final observation explains the missing value', async () => {
    const issues = await validateObservationStatusValueConsistency({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '72166-2' }],
      },
      dataAbsentReason: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }],
      },
    }, 'Observation');

    expect(issues).toEqual([]);
  });

  it('still warns for final observations without value, components, or dataAbsentReason', async () => {
    const issues = await validateObservationStatusValueConsistency({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '72166-2' }],
      },
    }, 'Observation');

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('final-status-no-value');
  });
});
