import { describe, expect, it } from 'vitest';

import { ContainedResourceValidator } from '../contained-resource-validator';
import { isResolvedContainedReferenceIssue } from '../../core/validator-contained-issues';

describe('ContainedResourceValidator internal canonicals', () => {
  const validator = new ContainedResourceValidator();

  it('reports a #id canonical with no contained target, as the reference validator does', () => {
    const issues = validator.validate({
      resourceType: 'PlanDefinition',
      action: [{ definitionCanonical: '#activitydefinition-1' }],
      library: ['#logic'],
    });

    expect(issues.map(issue => issue.path).sort()).toEqual([
      'PlanDefinition.action[0].definitionCanonical',
      'PlanDefinition.library[0]',
    ]);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'contained-unresolved-canonical',
      severity: 'error',
      message: "The URL value '#logic' is invalid because there is no matching target",
    }));
  });

  it('accepts a #id canonical that names a contained resource and ignores other # strings', () => {
    const issues = validator.validate({
      resourceType: 'Questionnaire',
      contained: [{ resourceType: 'ValueSet', id: 'answers' }],
      description: '# Heading in markdown',
      item: [{ linkId: '1', type: 'choice', answerValueSet: '#answers' }],
    });

    expect(issues.filter(issue => issue.code === 'contained-unresolved-canonical')).toEqual([]);
  });

  it('lets a contained resource name its sibling, which only the container lists', () => {
    const questionnaire = { resourceType: 'Questionnaire', id: 'q', item: [{ linkId: '1', answerValueSet: '#answers' }] };
    const container = { resourceType: 'QuestionnaireResponse', contained: [questionnaire, { resourceType: 'ValueSet', id: 'answers' }] };
    const [embeddedIssue] = validator.validate(questionnaire);

    expect(embeddedIssue).toMatchObject({ code: 'contained-unresolved-canonical' });
    expect(isResolvedContainedReferenceIssue(embeddedIssue, container)).toBe(true);
    expect(isResolvedContainedReferenceIssue(embeddedIssue, { resourceType: 'QuestionnaireResponse', contained: [questionnaire] }))
      .toBe(false);
  });

  // sqlonfhir-r4 Bundle/ussg-fht: the Questionnaire of the first entry
  // contains the value set its items name.
  it('leaves a #id canonical inside a Bundle entry to that entry\'s own contained resources', () => {
    expect(validator.validate({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [{ resource: {
        resourceType: 'Questionnaire',
        contained: [{ resourceType: 'ValueSet', id: 'length' }],
        item: [{ linkId: '1', item: [{ linkId: '1.1', type: 'choice', answerValueSet: '#length' }] }],
      } }],
    })).toEqual([]);
  });
});
