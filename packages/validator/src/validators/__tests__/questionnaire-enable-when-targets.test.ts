import { describe, expect, it } from 'vitest';
import { validateEnableWhenTargets } from '../questionnaire-enable-when-targets';

const when = (question?: string) => [{ ...(question === undefined ? {} : { question }), operator: 'exists', answerBoolean: true }];
const check = (items: unknown[]) => validateEnableWhenTargets(items, 'Questionnaire.item')
  .map(issue => [issue.path, issue.severity, issue.message]);

describe('where a Questionnaire item\'s enableWhen points', () => {
  it('accepts an earlier question, in its own group or an earlier one, and an enclosing group', () => {
    expect(check([
      { linkId: 'smoker', type: 'boolean' },
      { linkId: 'history', type: 'group', item: [
        { linkId: 'since', type: 'date', enableWhen: when('smoker') },
        { linkId: 'packs', type: 'integer', enableWhen: when('since') },
        { linkId: 'note', type: 'string', enableWhen: when('history') },
      ] },
    ])).toEqual([]);
  });

  // KBV's forms condition a question on one further down (MF_6).
  it('warns about a target further down', () => {
    expect(check([
      { linkId: 'MF_5', type: 'string', enableWhen: when('MF_6') },
      { linkId: 'MF_6', type: 'boolean' },
    ])).toEqual([['Questionnaire.item[0]', 'warning', 'The target of this enableWhen rule (MF_6) comes after the question itself']]);
  });

  it('rejects a missing, unknown, own or inner target', () => {
    expect(check([
      { linkId: 'a', type: 'boolean', enableWhen: when() },
      { linkId: 'b', type: 'boolean', enableWhen: when('nowhere') },
      { linkId: 'c', type: 'boolean', enableWhen: when('c') },
      { linkId: 'd', type: 'group', enableWhen: when('d1'), item: [{ linkId: 'd1', type: 'boolean' }] },
    ])).toEqual([
      ['Questionnaire.item[0]', 'error', 'Questions with an enableWhen must have a value for the question link'],
      ['Questionnaire.item[1]', 'error', "Unable to find an item with the linkId 'nowhere' which is referenced in the enableWhen for 'b'"],
      ['Questionnaire.item[2]', 'error', "Target for this question enableWhen can't reference itself"],
      ['Questionnaire.item[3]', 'error', 'Questions with an enableWhen cannot refer to an inner question for its enableWhen condition'],
    ]);
  });
});
