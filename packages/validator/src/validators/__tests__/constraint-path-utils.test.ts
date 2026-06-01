import { describe, expect, it } from 'vitest';
import { elementExistsInResource, getEvaluationContext } from '../constraint-path-utils';

describe('constraint path utilities', () => {
  const patient = {
    resourceType: 'Patient',
    identifier: [
      { value: 'plain' },
      {
        _value: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'masked',
          }],
        },
      },
    ],
  };

  it('resolves the resource root path to the resource', () => {
    expect(elementExistsInResource(patient, 'Patient')).toBe(true);
    expect(getEvaluationContext(patient, 'Patient')).toBe(patient);
  });

  it('treats primitive sidecar-only values as existing elements', () => {
    expect(elementExistsInResource(patient, 'Patient.identifier[1].value')).toBe(true);
  });

  it('returns the primitive sidecar as the evaluation context instead of the root resource', () => {
    expect(getEvaluationContext(patient, 'Patient.identifier[1].value')).toEqual({
      extension: [{
        url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
        valueCode: 'masked',
      }],
    });
  });

  it('does not fall back to the root resource for truly missing primitive paths', () => {
    expect(getEvaluationContext(patient, 'Patient.identifier[0].assigner')).toBeUndefined();
  });
});
