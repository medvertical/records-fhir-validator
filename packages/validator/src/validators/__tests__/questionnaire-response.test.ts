import { describe, it, expect } from 'vitest';
import { QuestionnaireValidator } from '../questionnaire-validator';
import { ValueSetCache } from '../valueset-cache';

const valueSetCache = new ValueSetCache();
const validator = new QuestionnaireValidator(valueSetCache);

describe('QuestionnaireValidator — QuestionnaireResponse', () => {
  it('flags missing status as error', () => {
    const qr = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr-1',
      questionnaire: 'http://example.org/Questionnaire/test',
      item: [{ linkId: 'q1', answer: [{ valueString: 'hello' }] }],
    };

    const issues = validator.validateQuestionnaireResponse(qr);
    const statusIssues = issues.filter(i => i.code === 'qr-missing-status');
    expect(statusIssues).toHaveLength(1);
    expect(statusIssues[0].severity).toBe('error');
  });

  it('flags missing linkId in response item', () => {
    const qr = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr-2',
      status: 'completed',
      item: [{ answer: [{ valueString: 'hello' }] }],
    };

    const issues = validator.validateQuestionnaireResponse(qr);
    const linkIdIssues = issues.filter(i => i.code === 'qr-missing-linkid');
    expect(linkIdIssues).toHaveLength(1);
    expect(linkIdIssues[0].severity).toBe('error');
  });

  it('normalizes malformed response items instead of trusting their shape', () => {
    const issues = validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 42, answer: [null] }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'qr-missing-linkid',
      path: 'QuestionnaireResponse.item[0].linkId',
    }));
  });

  it('reports a malformed answer value without throwing', () => {
    const issues = validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 'choice', answer: [{ valueCoding: null }] }],
    }, {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [{ linkId: 'choice', type: 'choice' }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'qr-type-mismatch',
      path: 'QuestionnaireResponse.item[0].answer[0].value',
    }));
  });

  // sIRB's populated responses answer a choice question with a Coding that
  // names only a display.
  it('types a Coding answer by its property whatever it carries', () => {
    const issues = validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 'site', answer: [{ valueCoding: { display: 'Central Campus Test University' } }] }],
    }, {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [{ linkId: 'site', type: 'choice' }],
    });

    expect(issues.filter(issue => issue.code === 'qr-type-mismatch')).toEqual([]);
  });

  it('validates nested QuestionnaireResponse items below answers', () => {
    const issues = validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{
        linkId: 'parent',
        answer: [{ valueString: 'yes', item: [{}] }],
      }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'qr-missing-linkid',
      path: 'QuestionnaireResponse.item[0].answer[0].item[0].linkId',
    }));
  });

  it('validates deeply nested response trees without recursive stack growth', () => {
    const questionnaireRoot: Record<string, unknown> = {
      linkId: 'q-0',
      type: 'group',
    };
    const responseRoot: Record<string, unknown> = { linkId: 'q-0' };
    let questionnaireItem = questionnaireRoot;
    let responseItem = responseRoot;
    for (let index = 1; index < 5_000; index++) {
      const nextQuestion = { linkId: `q-${index}`, type: 'group' };
      const nextResponse = { linkId: `q-${index}` };
      questionnaireItem.item = [nextQuestion];
      responseItem.item = [nextResponse];
      questionnaireItem = nextQuestion;
      responseItem = nextResponse;
    }

    expect(() => validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [responseRoot],
    }, {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [questionnaireRoot],
    })).not.toThrow();
  });

  it('terminates safely for cyclic response and questionnaire item graphs', () => {
    const questionnaireItem: Record<string, unknown> = {
      linkId: 'group',
      type: 'group',
    };
    questionnaireItem.item = [questionnaireItem];
    const responseItem: Record<string, unknown> = { linkId: 'group' };
    responseItem.item = [responseItem];

    expect(() => validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [responseItem],
    }, {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [questionnaireItem],
    })).not.toThrow();
  });

  it('ignores malformed contained and response values without throwing', () => {
    expect(() => validator.validateAnyResource({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      contained: [null, 42, 'invalid'],
      item: [{ linkId: 'question', answer: [null] }],
    })).not.toThrow();
  });

  it('returns no issues for valid QuestionnaireResponse', () => {
    const qr = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr-3',
      status: 'completed',
      questionnaire: 'http://example.org/Questionnaire/test',
      item: [{ linkId: 'q1', answer: [{ valueString: 'hello' }] }],
    };

    const issues = validator.validateQuestionnaireResponse(qr);
    expect(issues).toHaveLength(0);
  });

  it('can warn when a QuestionnaireResponse questionnaire reference is not resolved by the engine', () => {
    const qr = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr-unresolved-questionnaire',
      status: 'completed',
      questionnaire: 'Questionnaire/5497895',
      item: [{ linkId: 'q1', answer: [{ valueString: 'hello' }] }],
    };

    const issues = validator.validateQuestionnaireResponse(qr, undefined, {
      warnOnUnresolvedQuestionnaireReference: true,
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'questionnaire-reference-not-resolved',
        path: 'QuestionnaireResponse',
        severity: 'warning',
      }),
    ]));
  });

  it('reports a canonical that resolves to the wrong conformance resource type', () => {
    const canonical = 'http://example.org/ValueSet/not-a-questionnaire';
    valueSetCache.setValueSetFile(canonical, {
      resourceType: 'ValueSet',
      url: canonical,
      status: 'active',
    });

    const issues = validator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      questionnaire: canonical,
    }, undefined, { warnOnUnresolvedQuestionnaireReference: true });
    valueSetCache.clear();

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'questionnaire-reference-wrong-type',
      severity: 'error',
      path: 'QuestionnaireResponse.questionnaire',
    }));
  });

  it('does not read wrong-type canonicals from another validator cache', () => {
    const canonical = 'http://example.org/canonical/shared-only';
    valueSetCache.setValueSetFile(canonical, {
      resourceType: 'ValueSet',
      url: canonical,
      status: 'active',
    });
    const isolatedValidator = new QuestionnaireValidator(new ValueSetCache());

    const issues = isolatedValidator.validateQuestionnaireResponse({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      questionnaire: canonical,
    }, undefined, { warnOnUnresolvedQuestionnaireReference: true });
    valueSetCache.clear();

    expect(issues.some(issue => issue.code === 'questionnaire-reference-wrong-type')).toBe(false);
  });

  it('applies maxDecimalPlaces to decimal and quantity answers', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [
        {
          linkId: 'decimal',
          type: 'decimal',
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces',
            valueInteger: 2,
          }],
        },
        {
          linkId: 'quantity',
          type: 'quantity',
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces',
            valueInteger: 2,
          }],
        },
      ],
    };
    const qr = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        { linkId: 'decimal', answer: [{ valueDecimal: 1.666 }] },
        { linkId: 'quantity', answer: [{ valueQuantity: { value: 1.666, unit: 'm' } }] },
      ],
    };

    const issues = validator.validateQuestionnaireResponse(qr, questionnaire);

    expect(issues.filter(i => i.code === 'questionnaire-sdc-maxdecimalplaces')).toHaveLength(2);
  });

  it('requires an echoed item text to be the question text', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      status: 'active',
      item: [
        { linkId: 'sleep', type: 'string', text: 'Trouble falling or staying asleep' },
        { linkId: 'mood', type: 'string' },
      ],
    };
    const qr = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        { linkId: 'sleep', text: 'Trouble falling or staying asleep', answer: [{ valueString: 'no' }] },
        { linkId: 'sleep', text: 'Trouble sleeping', answer: [{ valueString: 'no' }] },
        { linkId: 'mood', text: 'Mood', answer: [{ valueString: 'fine' }] },
        { linkId: 'mood', answer: [{ valueString: 'fine' }] },
      ],
    };

    const issues = validator.validateQuestionnaireResponse(qr, questionnaire)
      .filter(issue => issue.code === 'qr-item-text-mismatch');

    expect(issues.map(issue => [issue.path, issue.severity, issue.message])).toEqual([
      ['QuestionnaireResponse.item[1]', 'error', 'If text exists, it must match the questionnaire definition for linkId sleep'],
      ['QuestionnaireResponse.item[2]', 'error', 'If text exists, it must match the questionnaire definition for linkId mood'],
    ]);
  });

  it('skips non-QuestionnaireResponse resources', () => {
    const patient = { resourceType: 'Patient', id: 'p1' };
    const issues = validator.validateQuestionnaireResponse(patient);
    expect(issues).toHaveLength(0);
  });
});

describe('QuestionnaireValidator — Questionnaire', () => {
  it('flags missing status as error', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-1',
      item: [{ linkId: 'q1', type: 'string' }],
    };

    const issues = validator.validateQuestionnaire(q);
    const statusIssues = issues.filter(i => i.code === 'questionnaire-missing-status');
    expect(statusIssues).toHaveLength(1);
    expect(statusIssues[0].severity).toBe('error');
  });

  it('flags duplicate linkIds', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-2',
      status: 'active',
      item: [
        { linkId: 'q1', type: 'string' },
        { linkId: 'q1', type: 'boolean' },
      ],
    };

    const issues = validator.validateQuestionnaire(q);
    const dupIssues = issues.filter(i => i.code === 'questionnaire-invariant-que-2');
    expect(dupIssues).toHaveLength(1);
  });

  it('uses the R5 que-1b warning for an empty group', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-r5-empty-group',
      status: 'active',
      item: [{ linkId: 'group', type: 'group' }],
    };

    const issues = validator.validateQuestionnaire(q, 'Questionnaire', 'R5');
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-que-1b',
      severity: 'warning',
      path: 'Questionnaire.item[0]',
    }));
    expect(issues.some(issue => issue.code === 'questionnaire-invariant-que-1')).toBe(false);
  });

  it('returns no issues for valid Questionnaire', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-3',
      status: 'active',
      item: [
        { linkId: 'q1', type: 'string' },
        { linkId: 'q2', type: 'boolean' },
      ],
    };

    const issues = validator.validateQuestionnaire(q);
    expect(issues).toHaveLength(0);
  });

  it('allows answerOption on FHIR answer-capable Questionnaire item types', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-answer-options',
      status: 'active',
      item: [
        {
          linkId: 'coding-question',
          type: 'coding',
          answerOption: [
            { valueCoding: { system: 'http://loinc.org', code: 'LA32971-6', display: 'Met' } },
          ],
        },
        {
          linkId: 'string-question',
          type: 'string',
          answerOption: [
            { valueString: 'Free text option' },
          ],
        },
      ],
    };

    const issues = validator.validateQuestionnaire(q);
    expect(issues.filter(i => i.code === 'questionnaire-invariant-que-5')).toHaveLength(0);
  });

  it('rejects answerOption on non-answer Questionnaire item types', () => {
    const q = {
      resourceType: 'Questionnaire',
      id: 'q-invalid-answer-options',
      status: 'active',
      item: [
        {
          linkId: 'display-with-options',
          type: 'display',
          answerOption: [
            { valueString: 'Invalid' },
          ],
        },
      ],
    };

    const issues = validator.validateQuestionnaire(q);
    expect(issues.filter(i => i.code === 'questionnaire-invariant-que-5')).toHaveLength(1);
  });
});
