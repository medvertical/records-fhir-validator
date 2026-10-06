import { describe, expect, it } from 'vitest';
import { QuestionnaireValidator } from '../questionnaire-validator';
import { ValueSetCache } from '../valueset-cache';

const validator = new QuestionnaireValidator(new ValueSetCache());

const questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  item: [
    { linkId: 'name', type: 'string' },
    { linkId: 'history', type: 'group', item: [{ linkId: 'smoker', type: 'boolean' }, { linkId: 'since', type: 'date' }] },
    { linkId: 'consent', type: 'boolean', item: [{ linkId: 'consent-date', type: 'date' }] },
  ],
};

const messages = (items: unknown[]) => validator
  .validateQuestionnaireResponse({ resourceType: 'QuestionnaireResponse', status: 'completed', item: items }, questionnaire)
  .filter(issue => issue.code === 'structure' || issue.code === 'not-found')
  .map(issue => [issue.path, issue.message]);

describe('QuestionnaireResponse items against the questionnaire\'s levels', () => {
  it('accepts items in place and in order, below groups and answers', () => {
    expect(messages([
      { linkId: 'name', answer: [{ valueString: 'Ann' }] },
      { linkId: 'history', item: [{ linkId: 'smoker', answer: [{ valueBoolean: true }] }, { linkId: 'since', answer: [{ valueDate: '2001' }] }] },
      { linkId: 'consent', answer: [{ valueBoolean: true, item: [{ linkId: 'consent-date', answer: [{ valueDate: '2020' }] }] }] },
    ])).toEqual([]);
  });

  it('reports an item the questionnaire defines on another level, at the level holding it', () => {
    expect(messages([{ linkId: 'smoker', answer: [{ valueBoolean: true }] }])).toEqual([
      ['QuestionnaireResponse', 'Structural Error: item with linkid smoker is in the wrong place'],
    ]);
  });

  it('reports items out of the questionnaire\'s order', () => {
    expect(messages([
      { linkId: 'history', item: [{ linkId: 'since', answer: [{ valueDate: '2001' }] }, { linkId: 'smoker', answer: [{ valueBoolean: true }] }] },
      { linkId: 'name', answer: [{ valueString: 'Ann' }] },
    ])).toEqual([
      ['QuestionnaireResponse', 'Structural Error: items are out of order'],
      ['QuestionnaireResponse.item[0]', 'Structural Error: items are out of order'],
    ]);
  });

  it('reports a non-repeating item that occurs more than once', () => {
    expect(messages([
      { linkId: 'name', answer: [{ valueString: 'Ann' }] },
      { linkId: 'name', answer: [{ valueString: 'Bob' }] },
    ])).toEqual([['QuestionnaireResponse', 'Only one response item with the linkId name allowed - found 2 items']]);
  });

  it('reports an unknown linkId once, at the level holding it', () => {
    expect(messages([{ linkId: 'history', item: [{ linkId: 'unknown', answer: [{ valueString: 'x' }] }] }])).toEqual([
      ['QuestionnaireResponse.item[0]', "LinkId 'unknown' not found in questionnaire"],
    ]);
  });
});

describe('a response authored outside the questionnaire\'s effective period', () => {
  const authored = (date: string) => validator.validateQuestionnaireResponse(
    { resourceType: 'QuestionnaireResponse', status: 'completed', authored: date },
    { resourceType: 'Questionnaire', status: 'active', effectivePeriod: { start: '2024-01-01', end: '2024-12-31' } },
  ).filter(issue => issue.code === 'questionnaire-authored-outside-period').map(issue => [issue.severity, issue.message]);

  it('draws a warning before the start and after the end', () => {
    expect(authored('2024-06-01T10:00:00Z')).toEqual([]);
    expect(authored('2023-12-31')).toEqual([['warning',
      "The authored date '2023-12-31' is before the start of the permitted period defined in the Questionnaire ('2024-01-01')"]]);
    expect(authored('2025-01-02')).toEqual([['warning',
      "The authored date '2025-01-02' is after the end of the permitted period defined in the Questionnaire ('2024-12-31')"]]);
  });
});
