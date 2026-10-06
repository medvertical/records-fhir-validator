import { describe, expect, it } from 'vitest';

import { resolveConstraintContext } from '../constraint-context-resolver';

describe('constraint context resolver', () => {
  it('rewrites a repeated backbone choice expression from the resource root', () => {
    const observation = {
      resourceType: 'Observation',
      component: [
        { valueString: 'text' },
        { valueQuantity: { value: 4, unit: 'mg' } },
      ],
    };

    expect(resolveConstraintContext(
      observation,
      'Observation.component[1]',
      'value.exists()',
    )).toEqual({
      context: observation,
      expression: 'component[1].all(value.exists())',
    });
  });

  it('rewrites from the root when the choice value exists only as an underscore sidecar', () => {
    const inv1 = '(part.exists() and value.empty() and resource.empty()) or (part.empty() and (value.exists() xor resource.exists()))';
    const parameters = {
      resourceType: 'Parameters',
      parameter: [{
        name: 'Is pregnancy confirmed',
        _valueBoolean: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'unknown',
          }],
        },
      }],
    };

    expect(resolveConstraintContext(
      parameters,
      'Parameters.parameter[0]',
      inv1,
    )).toEqual({
      context: parameters,
      expression: `parameter[0].all(${inv1})`,
    });
  });

  it('navigates a concrete choice element so its value keeps its FHIR type', () => {
    const observation = {
      resourceType: 'Observation',
      effectiveDateTime: '2024-10-01T09:30:00Z',
      component: [{ valueQuantity: { value: 4, unit: 'mg' } }],
    };

    expect(resolveConstraintContext(
      observation,
      'Observation.effectiveDateTime',
      '($this as dateTime).toString().length() >= 8',
    )).toEqual({
      context: observation,
      expression: 'effective.all(($this as dateTime).toString().length() >= 8)',
    });
    expect(resolveConstraintContext(
      observation,
      'Observation.component[0].valueQuantity',
      'value.exists()',
    )).toEqual({
      context: observation,
      expression: 'component[0].value.all(value.exists())',
    });
  });

  it('navigates a concrete choice element from the resource that contains it', () => {
    const observation = { resourceType: 'Observation', effectiveDateTime: '2024-10-01' };
    const bundle = { resourceType: 'Bundle', entry: [{ resource: observation }] };

    expect(resolveConstraintContext(
      bundle,
      'Bundle.entry[0].resource.effectiveDateTime',
      '$this.exists()',
    )).toEqual({
      context: observation,
      expression: 'effective.all($this.exists())',
    });
  });

  it('does not treat an ordinary element with a type-like suffix as a choice', () => {
    const patient = { resourceType: 'Patient', birthDate: '1970-01-01' };

    expect(resolveConstraintContext(
      patient,
      'Patient.birthDate',
      '$this.exists()',
    )).toEqual({
      context: '1970-01-01',
      expression: '$this.exists()',
    });
  });

  it('returns all repeated scalar contexts instead of silently using the root', () => {
    const patient = {
      resourceType: 'Patient',
      name: [
        { family: 'Curie' },
        { family: 'Meitner' },
      ],
    };

    expect(resolveConstraintContext(
      patient,
      'Patient.name.family',
      '$this.exists()',
    )).toEqual({
      context: ['Curie', 'Meitner'],
      expression: '$this.exists()',
    });
  });
});
