import { describe, expect, it } from 'vitest';
import { deepProfileValidator } from '../deep-profile-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

describe('DeepProfileValidator', () => {
  it('matches CodeableConcept patterns against any repeated element item', () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/condition-category-pattern',
      name: 'ConditionCategoryPattern',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Condition',
      snapshot: {
        element: [
          { id: 'Condition', path: 'Condition' },
          {
            id: 'Condition.category',
            path: 'Condition.category',
            patternCodeableConcept: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                code: 'problem-list-item',
              }],
            },
          },
        ],
      },
    };

    const issues = deepProfileValidator.validate({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
            display: 'Problem List Item',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: profile,
    });

    expect(issues.filter(issue => issue.code === 'profile-pattern-mismatch')).toHaveLength(0);
  });
});
