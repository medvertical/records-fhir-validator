import { describe, it, expect } from 'vitest';
import { QuestionnaireValidator } from '../questionnaire-validator';

const validator = new QuestionnaireValidator();

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
});
