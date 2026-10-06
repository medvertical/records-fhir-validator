import { describe, expect, it } from 'vitest';
import { preprocessTypeLiterals } from '../fhirpath-type-preprocessor';

const ctx = (elementType: string | null, resourceType = 'AppointmentResponse') => ({ elementType, resourceType, rootResourceType: resourceType });

// NO Basis' inv-1 reads a Reference's uri type as `actor.type.value`; the
// reference validator takes that as the uri itself, fhirpath.js as nothing.
describe('`value` read from a primitive the context reaches by path', () => {
  it('becomes the primitive itself outside function arguments', () => {
    expect(preprocessTypeLiterals(
      "extension.where(url = 'http://hl7.no/fhir/StructureDefinition/no-basis-shortnotice').value.exists() and actor.type.value = 'Patient'",
      ctx('AppointmentResponse'),
    )).toBe("extension.where(url = 'http://hl7.no/fhir/StructureDefinition/no-basis-shortnotice').value.exists() and actor.type = 'Patient'");
    expect(preprocessTypeLiterals('birthDate.value < today()', ctx('Patient', 'Patient'))).toBe('birthDate < today()');
  });

  it('keeps the value of complex types, choices, literals and iteration items', () => {
    for (const [expression, type] of [
      ['valueQuantity.value > 5', 'Observation'],
      ['identifier.value.exists()', 'Patient'],
      ["code.text = 'type.value'", 'Observation'],
      ['participant.where(actor.type.value = 1).exists()', 'Appointment'],
    ] as const) {
      expect(preprocessTypeLiterals(expression, ctx(type, type))).toBe(expression);
    }
  });
});
