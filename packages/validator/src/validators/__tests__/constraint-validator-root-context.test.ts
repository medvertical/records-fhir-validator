import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

describe('ConstraintValidator resource-root expression handling', () => {
  it('evaluates absolute resource-root expressions from nested elements only once', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        active: false,
        name: [
          { family: 'Curie' },
          { family: 'Meitner' },
        ],
      },
      [
        {
          id: 'Patient.name',
          path: 'Patient.name',
          min: 0,
          constraint: [{
            key: 'root-active',
            severity: 'error' as const,
            human: 'Patient must be active',
            expression: 'Patient.active = true',
          }],
        },
      ],
      'http://example.org/StructureDefinition/Patient',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      path: 'Patient.name',
      ruleId: 'root-active',
    }));
  });

  it('does not flag nested absolute resource-root expressions when the root matches', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        active: true,
        name: [{ family: 'Curie' }],
      },
      [
        {
          id: 'Patient.name',
          path: 'Patient.name',
          min: 0,
          constraint: [{
            key: 'root-active',
            severity: 'error' as const,
            human: 'Patient must be active',
            expression: '(Patient.active = true)',
          }],
        },
      ],
      'http://example.org/StructureDefinition/Patient',
    );

    expect(issues).toHaveLength(0);
  });
});
