import { describe, expect, it } from 'vitest';

import {
  choiceElementsAt,
  deriveChoiceTypeFromConcretePath,
  prepareElementContext,
  resolveChoiceTypeCast,
} from '../sd-fhirpath-choice-utils';

describe('SD FHIRPath choice utilities', () => {
  it('derives primitive and complex choice types from concrete paths', () => {
    expect(deriveChoiceTypeFromConcretePath({
      resourcePath: 'Observation.valueDateTime',
      element: { path: 'Observation.value[x]' },
    })).toBe('dateTime');
    expect(deriveChoiceTypeFromConcretePath({
      resourcePath: 'Observation.valueQuantity',
      element: { path: 'Observation.value[x]' },
    })).toBe('Quantity');
  });

  it('ignores malformed matcher shapes', () => {
    expect(deriveChoiceTypeFromConcretePath({ resourcePath: 42, element: null })).toBeNull();
    expect(resolveChoiceTypeCast('($this as dateTime).exists()', null)).toEqual({
      skip: false,
      expression: '($this as dateTime).exists()',
    });
  });

  it('strips a verified matching cast and skips a mismatching cast', () => {
    const matched = {
      resourcePath: 'Observation.valueDateTime',
      element: { path: 'Observation.value[x]' },
      data: '2026-07-26',
    };

    expect(resolveChoiceTypeCast('($this as dateTime).exists()', matched)).toEqual({
      skip: false,
      expression: '($this).exists()',
    });
    expect(resolveChoiceTypeCast('($this as Quantity).exists()', matched).skip).toBe(true);
  });

  it('normalizes choice aliases inside cyclic arrays without recursing forever', () => {
    const source: unknown[] = [{ valueString: 'first' }];
    source.push(source, { valueString: 'last' });

    const normalized = prepareElementContext(source, 'value.exists()');

    expect(Array.isArray(normalized)).toBe(true);
    const normalizedArray = normalized as unknown[];
    expect(normalizedArray[0]).toEqual({ valueString: 'first', value: 'first' });
    expect(normalizedArray[1]).toBe(normalizedArray);
    expect(normalizedArray[2]).toEqual({ valueString: 'last', value: 'last' });
  });

  it('keeps a choice value that exists through its sidecar alone', () => {
    const absent = { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }] };

    expect(prepareElementContext({ name: 'a', _valueBoolean: absent }, 'value.exists()'))
      .toEqual({ name: 'a', _valueBoolean: absent, _value: absent });
  });

  it('does not add aliases that the expression never references', () => {
    const context = { valueString: 'kept concrete' };

    expect(prepareElementContext(context, 'status.exists()')).toBe(context);
  });

  // CH ELM's TestScripts assert on responseCode; TestScript.test.action.assert
  // is defined by content reference to TestScript.setup.action.assert, where
  // `response` is a code of its own, not a choice.
  it('follows content references before taking a property for a choice value', () => {
    const assert = { direction: 'response', responseCode: '200' };
    expect(prepareElementContext(assert, 'response.count()', choiceElementsAt('TestScript.test[0].action[1].assert', 'R4')))
      .toEqual(assert);
  });
});

