import { describe, expect, it } from 'vitest';

import type { ValidationIssue } from '@records-fhir/validation-types';
import { aggregateRemoteCodeSystemBudgetIssues } from '../validation-utils';
import { validationIssue as issue } from './validation-issue-test-builders';

describe('aggregateRemoteCodeSystemBudgetIssues', () => {
  it('keeps small sets of remote budget exhaustion issues path-specific', () => {
    const issues = [
      remoteBudgetIssue('1111-1', 'Questionnaire.item[0].code'),
      remoteBudgetIssue('2222-2', 'Questionnaire.item[1].code'),
    ];

    expect(aggregateRemoteCodeSystemBudgetIssues(issues)).toEqual(issues);
  });

  it('aggregates noisy remote budget exhaustion issues by code system', () => {
    const issues = Array.from({ length: 6 }, (_, index) =>
      remoteBudgetIssue(`10000-${index}`, `Questionnaire.item[${index}].code`)
    );

    const aggregated = aggregateRemoteCodeSystemBudgetIssues(issues);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      aspect: 'terminology',
      severity: 'information',
      code: 'terminology-codesystem-unverified',
      details: {
        system: 'http://loinc.org',
        reason: 'remote-budget-exhausted',
        count: 6,
        sampleCodes: ['10000-0', '10000-1', '10000-2', '10000-3', '10000-4'],
      },
    });
    expect(aggregated[0].message).toContain('6 codes from http://loinc.org');
    expect(aggregated[0].details).not.toHaveProperty('code');
    expect(aggregated[0].details).not.toHaveProperty('display');
  });
});

function remoteBudgetIssue(code: string, path: string): ValidationIssue {
  return issue({
    aspect: 'terminology',
    severity: 'information',
    code: 'terminology-codesystem-unverified',
    message: `Remote CodeSystem validation budget was exhausted; http://loinc.org#${code} was not verified against the terminology server`,
    path,
    details: {
      code,
      display: `Display ${code}`,
      system: 'http://loinc.org',
      reason: 'remote-budget-exhausted',
    },
  });
}
