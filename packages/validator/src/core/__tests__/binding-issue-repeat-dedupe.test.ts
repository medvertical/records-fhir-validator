import { describe, expect, it } from 'vitest';
import { withoutElementLevelBindingDuplicates } from '../binding-issue-repeat-dedupe';
import { validationIssue as issue } from './validation-issue-test-builders';

const notInIdentifierType =
  "Code 'MB' from system 'http://terminology.hl7.org/CodeSystem/v2-0203' is not in value set "
  + "'http://hl7.org/fhir/ValueSet/identifier-type' (binding strength: extensible)";

function binding(path: string, message = notInIdentifierType) {
  return issue({ aspect: 'terminology', severity: 'warning', code: 'terminology-binding-extensible', path, message });
}

describe('withoutElementLevelBindingDuplicates', () => {
  it('drops the element-level copy of a finding that stands at a repeat', () => {
    const atRepeat = binding('Patient.identifier[0].type');
    const atElement = binding('Patient.identifier.type');

    expect(withoutElementLevelBindingDuplicates([atRepeat, atElement])).toEqual([atRepeat]);
  });

  it('keeps an element-level finding about another value set or without a repeat to match', () => {
    const atRepeat = binding('Patient.identifier[0].type');
    const otherValueSet = binding(
      'Patient.identifier.type',
      "Code 'MB' from system 'http://terminology.hl7.org/CodeSystem/v2-0203' is not in value set "
        + "'http://hl7.org/fhir/us/carin-bb/ValueSet/C4BBPatientIdentifierType' (binding strength: extensible)",
    );
    const alone = binding('Coverage.type');

    expect(withoutElementLevelBindingDuplicates([atRepeat, otherValueSet, alone]))
      .toEqual([atRepeat, otherValueSet, alone]);
  });
});
