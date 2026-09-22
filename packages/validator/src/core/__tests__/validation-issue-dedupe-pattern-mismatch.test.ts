import { describe, expect, it } from 'vitest';
import { dedupeIssues, dedupeIssuesWithTrace } from '../validation-utils';
import { validationIssue as issue } from './validation-issue-test-builders';

const CATEGORY_PATTERN = {
  coding: [{ code: 'vital-signs', system: 'http://terminology.hl7.org/CodeSystem/observation-category' }],
};

function parentMismatch(path = 'Observation.category[0]') {
  return issue({
    aspect: 'profile',
    code: 'profile-pattern-mismatch',
    severity: 'error',
    path,
    resourceType: 'Observation',
    message: `Element ${path} does not match required pattern: expected ${JSON.stringify(CATEGORY_PATTERN)}`,
    details: { expectedPattern: JSON.stringify(CATEGORY_PATTERN) },
  });
}

function childMismatch(path = 'Observation.category[0].coding[0]') {
  return issue({
    aspect: 'structural',
    code: 'profile-pattern-mismatch',
    severity: 'error',
    path,
    resourceType: 'Observation',
    message: `Element '${path}' does not contain an item matching pattern entry 0`,
  });
}

describe('pattern mismatch dedupe', () => {
  it('keeps only the deeper diagnostic when both walks report one violation', () => {
    const deduped = dedupeIssues([parentMismatch(), childMismatch()]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe('Observation.category[0].coding[0]');
  });

  it('records the suppression under a named rule', () => {
    const { suppressions } = dedupeIssuesWithTrace([parentMismatch(), childMismatch()]);

    expect(suppressions.map(entry => entry.ruleId)).toContain('specific-pattern-mismatch-over-parent');
  });

  it('keeps a lone parent diagnostic when nothing deeper was reported', () => {
    const deduped = dedupeIssues([parentMismatch()]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe('Observation.category[0]');
  });

  it('keeps mismatches on sibling elements that share a path prefix', () => {
    const deduped = dedupeIssues([
      parentMismatch('Observation.category[0]'),
      childMismatch('Observation.categoryExtra[0].coding[0]'),
    ]);

    expect(deduped.map(entry => entry.path)).toEqual(expect.arrayContaining([
      'Observation.category[0]',
      'Observation.categoryExtra[0].coding[0]',
    ]));
    expect(deduped).toHaveLength(2);
  });

  it('keeps mismatches reported on different repeats of the same element', () => {
    const deduped = dedupeIssues([
      parentMismatch('Observation.category[0]'),
      childMismatch('Observation.category[1].coding[0]'),
    ]);

    expect(deduped.map(entry => entry.path)).toEqual(expect.arrayContaining([
      'Observation.category[0]',
      'Observation.category[1].coding[0]',
    ]));
    expect(deduped).toHaveLength(2);
  });
});
