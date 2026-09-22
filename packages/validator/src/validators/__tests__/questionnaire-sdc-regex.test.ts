import { describe, expect, it } from 'vitest';
import { validateQuestionnaireSdcConstraints } from '../questionnaire-sdc-validator';
import type { QuestionnaireItem } from '../questionnaire-types';

const REGEX_EXTENSION = 'http://hl7.org/fhir/StructureDefinition/regex';

function questionMap(regex: string): Map<string, QuestionnaireItem> {
  return new Map([['q1', {
    linkId: 'q1',
    type: 'string',
    extension: [{ url: REGEX_EXTENSION, valueString: regex }],
  } as QuestionnaireItem]]);
}

function answer(value: string): unknown[] {
  return [{ linkId: 'q1', answer: [{ valueString: value }] }];
}

describe('questionnaire regex constraints', () => {
  it('flags an answer that does not match a valid pattern', () => {
    const issues = validateQuestionnaireSdcConstraints(
      answer('abc'), questionMap('^[0-9]+$'), 'QuestionnaireResponse',
    );
    expect(issues.map(issue => issue.code)).toEqual(['questionnaire-sdc-regex']);
  });

  it('accepts an answer that matches', () => {
    expect(validateQuestionnaireSdcConstraints(
      answer('123'), questionMap('^[0-9]+$'), 'QuestionnaireResponse',
    )).toEqual([]);
  });

  it('reports a pattern that does not compile instead of passing the answer', () => {
    const issues = validateQuestionnaireSdcConstraints(
      answer('abc'), questionMap('^[0-9'), 'QuestionnaireResponse',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'questionnaire-sdc-regex-unevaluable',
      severity: 'warning',
      path: expect.stringContaining('QuestionnaireResponse'),
    });
    expect(issues[0].message).toContain('^[0-9');
  });

  it('keeps the unevaluable answer out of the message', () => {
    const issues = validateQuestionnaireSdcConstraints(
      answer('0123456789'), questionMap('^[0-9'), 'QuestionnaireResponse',
    );
    expect(issues[0].message).not.toContain('0123456789');
  });
});
