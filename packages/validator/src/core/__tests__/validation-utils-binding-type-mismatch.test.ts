import { describe, expect, it } from 'vitest';
import { suppressRedundantBindingWarnings } from '../validation-utils';
import { validationIssue as issue } from './validation-issue-test-builders';

function typeMismatch(path: string) {
  return issue({
    aspect: 'structural',
    severity: 'error',
    code: 'structural-type-mismatch',
    path,
    resourceType: 'Observation',
    message: 'Expected Quantity, found string',
  });
}

function undeterminedSystem(path: string) {
  return issue({
    aspect: 'terminology',
    severity: 'error',
    code: 'terminology-system-undetermined',
    path,
    resourceType: 'Observation',
    message: 'The code system cannot be inferred from the ValueSet',
  });
}

describe('binding diagnostics on structurally mismatched values', () => {
  it('keeps the type error without a secondary code-system inference error', () => {
    const structural = typeMismatch('Observation.valueString');
    const terminology = undeterminedSystem('Observation.value[x]');

    expect(suppressRedundantBindingWarnings([structural, terminology]))
      .toEqual([structural]);
  });

  it('retains system inference errors without a type error at that value', () => {
    const unrelated = typeMismatch('Observation.valueString');
    const terminology = undeterminedSystem('Observation.status');

    expect(suppressRedundantBindingWarnings([unrelated, terminology]))
      .toEqual([unrelated, terminology]);
    expect(suppressRedundantBindingWarnings([terminology])).toEqual([terminology]);
  });

  it('does not suppress findings for another repeated element', () => {
    const structural = typeMismatch('Observation.component[0].valueString');
    const secondary = undeterminedSystem('Observation.component[0].value[x]');
    const independent = undeterminedSystem('Observation.component[1].value[x]');
    const warning = issue({
      aspect: 'terminology',
      severity: 'warning',
      code: 'terminology-binding-extensible',
      path: 'Observation.component[1].value[x]',
      message: 'Value is outside the extensible binding',
    });

    expect(suppressRedundantBindingWarnings([structural, secondary, independent, warning]))
      .toEqual([structural, independent, warning]);
  });

  it('preserves a definitive required-membership violation', () => {
    const structural = typeMismatch('Observation.valueString');
    const binding = issue({
      aspect: 'terminology',
      severity: 'error',
      code: 'terminology-binding-required',
      path: 'Observation.value[x]',
      message: 'Code is not in the required ValueSet',
    });

    expect(suppressRedundantBindingWarnings([structural, binding]))
      .toEqual([structural, binding]);
  });
});

describe('binding warnings next to an invalid code', () => {
  it('drops only the warning of the repeat whose code is invalid', () => {
    const invalidCode = issue({
      aspect: 'terminology',
      severity: 'error',
      code: 'terminology-code-invalid',
      path: 'ImagingStudy.series[0].performer[1].function.coding[0].code',
      message: "Unknown code 'ZZZZ'",
    });
    const binding = (index: number) => issue({
      aspect: 'terminology',
      severity: 'warning',
      code: 'terminology-binding-extensible',
      path: `ImagingStudy.series[0].performer[${index}].function`,
      message: 'Code is not in the extensible ValueSet',
    });

    const [first, second] = [binding(0), binding(1)];

    expect(suppressRedundantBindingWarnings([invalidCode, first, second]))
      .toEqual([invalidCode, first]);
  });
});
