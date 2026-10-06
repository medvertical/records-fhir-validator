import { describe, expect, it } from 'vitest';

import { hasUnresolvableChoiceTypes } from '../constraint-choice-context';

describe('constraint choice context', () => {
  it('detects dynamically derived choice bases', () => {
    expect(hasUnresolvableChoiceTypes(
      { subjectReference: { reference: 'Patient/example' } },
      'subject.exists()',
    )).toBe(true);
  });

  it('does not mistake ordinary prefix-sharing properties for choices', () => {
    expect(hasUnresolvableChoiceTypes(
      { valueSet: 'http://example.org/ValueSet/example' },
      'value.exists()',
    )).toBe(false);
  });

  it('detects choice bases present only through underscore sidecars', () => {
    expect(hasUnresolvableChoiceTypes(
      {
        name: 'Is pregnancy confirmed',
        _valueBoolean: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'unknown',
          }],
        },
      },
      '(part.exists() and value.empty() and resource.empty()) or (part.empty() and (value.exists() xor resource.exists()))',
    )).toBe(true);
  });

  it('ignores underscore sidecars of non-choice properties', () => {
    expect(hasUnresolvableChoiceTypes(
      { _id: { extension: [{ url: 'http://example.org/ext', valueCode: 'x' }] } },
      'id.exists()',
    )).toBe(false);
  });
});
