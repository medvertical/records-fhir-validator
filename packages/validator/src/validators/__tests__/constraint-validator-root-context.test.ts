import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

describe('ConstraintValidator resource-root expression handling', () => {
  it('binds context and resource types correctly for Bundle entry resources', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Patient', id: 'patient-1' } },
          { resource: { resourceType: 'Patient', id: 'patient-2' } },
        ],
      },
      [{
        path: 'Bundle.entry.resource',
        constraint: [{
          key: 'variables-test',
          severity: 'error' as const,
          human: 'Check context variables are set correctly',
          expression: "%context.type().name = 'Patient' and %resource.type().name = 'Bundle' and %rootResource.type().name = 'Bundle'",
        }],
      }],
      'http://example.org/StructureDefinition/bundle-context',
    );

    expect(issues.find(issue => issue.ruleId === 'variables-test')).toBeUndefined();
  });

  it('binds resource to the nearest contained resource ancestor', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        contained: [{
          resourceType: 'Practitioner',
          id: 'practitioner-1',
          name: [{ family: 'Curie' }],
        }],
      },
      [{
        path: 'Patient.contained.name',
        constraint: [{
          key: 'contained-context',
          severity: 'error' as const,
          human: 'Check contained-resource context variables',
          expression: "%context.type().name = 'HumanName' and %resource.type().name = 'Practitioner' and %rootResource.type().name = 'Patient'",
        }],
      }],
      'http://example.org/StructureDefinition/contained-context',
    );

    expect(issues.find(issue => issue.ruleId === 'contained-context')).toBeUndefined();
  });

  // FHIRPath reads a leading type name as a filter on the context: on
  // Patient.name, `Patient` selects nothing, as in the reference validator.
  it('evaluates a nested invariant that names the resource at each element', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        active: true,
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
            expression: '(Patient.active = true)',
          }],
        },
      ],
      'http://example.org/StructureDefinition/Patient',
    );

    expect(issues.map(issue => [issue.ruleId, issue.path])).toEqual([
      ['root-active', 'Patient.name[0]'],
      ['root-active', 'Patient.name[1]'],
    ]);
  });

  it('holds a nested element to what its resource-named paths select there', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        name: [{ family: 'Curie' }],
      },
      [
        {
          id: 'Patient.name',
          path: 'Patient.name',
          min: 0,
          constraint: [{
            key: 'root-guard',
            severity: 'error' as const,
            human: 'Named patients must state whether they are active',
            expression: 'Patient.active.exists() or Patient.name.exists().not()',
          }],
        },
      ],
      'http://example.org/StructureDefinition/Patient',
    );

    expect(issues).toHaveLength(0);
  });
});
