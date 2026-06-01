import { describe, expect, it } from 'vitest';
import { getDirectValue, getNestedValue } from '../structural-executor-helpers';

describe('structural executor value helpers', () => {
  it('treats primitive sidecar extensions as present values', () => {
    const identifier = {
      system: 'http://fhir.de/sid/gkv/kvid-10',
      _value: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'masked',
        }],
      },
    };

    expect(getNestedValue(identifier, 'value')).toEqual(identifier._value);
  });

  it('resolves primitive sidecars through resource paths', () => {
    const patient = {
      resourceType: 'Patient',
      identifier: [{
        _value: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'masked',
          }],
        },
      }],
    };

    expect(getDirectValue(patient, 'Patient.identifier.0.value')).toEqual(patient.identifier[0]._value);
  });
});
