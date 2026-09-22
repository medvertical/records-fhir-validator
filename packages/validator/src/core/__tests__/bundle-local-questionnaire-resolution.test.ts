import { beforeAll, describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';

const QUESTIONNAIRE_URN = 'urn:uuid:bc52dbf4-fd67-52e3-ba75-731a76805872';
const BUNDLE_PROFILE = 'http://hl7.org/fhir/StructureDefinition/Bundle';

/**
 * The Questionnaire exists only under its entry fullUrl: no Questionnaire.url,
 * so nothing outside the Bundle could ever answer the canonical. The response
 * answers one known linkId and one the Questionnaire does not define.
 */
const transactionBundle = {
  resourceType: 'Bundle',
  id: 'bundle-local-questionnaire',
  type: 'transaction',
  entry: [
    {
      fullUrl: QUESTIONNAIRE_URN,
      resource: {
        resourceType: 'Questionnaire',
        status: 'active',
        item: [{ linkId: 'q1', type: 'string', text: 'How are you?' }],
      },
      request: { method: 'POST', url: 'Questionnaire' },
    },
    {
      fullUrl: 'urn:uuid:5d1f0e6a-7b3c-4d2e-9f10-2a3b4c5d6e7f',
      resource: {
        resourceType: 'QuestionnaireResponse',
        status: 'completed',
        questionnaire: QUESTIONNAIRE_URN,
        item: [
          { linkId: 'q1', answer: [{ valueString: 'fine' }] },
          { linkId: 'stray', answer: [{ valueString: 'unexpected' }] },
        ],
      },
      request: { method: 'POST', url: 'QuestionnaireResponse' },
    },
  ],
};

function expectItemsValidatedAgainstBundledQuestionnaire(issues: ValidationIssue[]): void {
  expect(issues.filter(issue => issue.code === 'questionnaire-reference-not-resolved')).toEqual([]);
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      code: 'not-found',
      path: expect.stringMatching(/^Bundle\.entry\[1\]\.resource.*item\[1\]\.linkId$/),
      message: expect.stringContaining("'stray'"),
    }),
  ]));
}

describe('QuestionnaireResponse.questionnaire resolved inside the enclosing Bundle', () => {
  let validator: RecordsValidator;

  beforeAll(async () => {
    validator = new RecordsValidator({ autoDownload: false, enableCaching: true, strictMode: false });
    await validator.waitForInitialization();
  }, 120_000);

  it('validates the response items against the bundled Questionnaire on the single-resource path', async () => {
    const issues = await validator.validate(transactionBundle, BUNDLE_PROFILE, 'R4');

    expectItemsValidatedAgainstBundledQuestionnaire(issues);
  }, 120_000);

  it('validates the response items against the bundled Questionnaire on the multi-aspect path', async () => {
    const resultMap = await validator.validateBatch([transactionBundle], {
      fhirVersion: 'R4',
      profileUrl: BUNDLE_PROFILE,
      maxConcurrency: 1,
      aspects: ['structural'],
      settings: { validationStrictness: 'standard', aspects: {} },
    });
    const result = resultMap.get(transactionBundle) as { aspects: Array<{ issues: ValidationIssue[] }> };

    expectItemsValidatedAgainstBundledQuestionnaire(result.aspects.flatMap(aspect => aspect.issues));
  }, 120_000);
});
