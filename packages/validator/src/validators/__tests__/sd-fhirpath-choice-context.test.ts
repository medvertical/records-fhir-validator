import { describe, expect, it } from 'vitest';
import fhirpath from 'fhirpath';
import r4 from 'fhirpath/fhir-context/r4/index.js';
import { choiceElementsAt, prepareElementContext, typeChoiceContext } from '../sd-fhirpath-choice-utils';

// SDC 3.0.0 carries sdc-uc-1 on Questionnaire.useContext; the SDC example
// questionnaire-sdc-profile-example-ussg-fht declares species as CodeableConcept.
const useContext = {
  code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'species' },
  valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '337915000' }] },
};

describe('typeChoiceContext', () => {
  it('names a raw datatype so a type test on its choice is typed', () => {
    const context = typeChoiceContext(useContext, 'value is CodeableConcept', 'Questionnaire.useContext[0]', 'R4');

    expect(context).toMatchObject({ resourceType: 'UsageContext' });
    expect(fhirpath.evaluate(context as object, 'value is CodeableConcept and (value is Range).not()', {}, r4)).toEqual([true]);
  });

  it('leaves contexts alone that test no choice type or whose datatype is unknown', () => {
    expect(typeChoiceContext(useContext, 'value.exists()', 'Questionnaire.useContext[0]', 'R4')).toBe(useContext);
    expect(typeChoiceContext(useContext, 'value is CodeableConcept', 'Questionnaire.item[0]', 'R4')).toBe(useContext);
  });

  it('reads the datatype of an element inside a Bundle entry from its resource', () => {
    const path = 'Bundle.entry[0].resource/*Questionnaire/q*/.useContext[0]';

    expect(typeChoiceContext(useContext, 'value is CodeableConcept', path, 'R4')).toMatchObject({ resourceType: 'UsageContext' });
  });
});

// tst-5 on the core example testscript-example-history: the assert carries
// only responseCode, which is an element of its own and not response[x].
describe('choiceElementsAt', () => {
  const tst5 = 'extension.exists() or (contentType.count() + expression.count() + headerField.count() + minimumId.count()'
    + ' + navigationLinks.count() + path.count() + requestMethod.count() + resource.count() + responseCode.count()'
    + ' + response.count() + validateProfileId.count() <=1)';
  const assert = { direction: 'response', responseCode: '201', warningOnly: false };

  it('does not read an element named like a typed choice as that choice', () => {
    const isChoice = choiceElementsAt('TestScript.setup.action[3].assert', 'R4');
    const context = prepareElementContext(assert, tst5, isChoice);

    expect(isChoice('response')).toBe(false);
    expect(context).toBe(assert);
    expect(fhirpath.evaluate(context as object, tst5, {}, r4)).toEqual([true]);
  });

  it('keeps reading declared choices and unknown elements leniently', () => {
    const component = { code: { text: 'systolic' }, valueQuantity: { value: 120 } };

    expect(choiceElementsAt('Observation.component[0]', 'R4')('value')).toBe(true);
    expect(prepareElementContext(component, 'value.exists()', choiceElementsAt('Observation.component[0]', 'R4')))
      .toMatchObject({ value: { value: 120 } });
    expect(choiceElementsAt('Observation.component:systolic', 'R4')('value')).toBeUndefined();
  });
});
