import { describe, expect, it } from 'vitest';
import { dedupeIssues } from '../validation-utils';
import type { ValidationIssue } from '../../types';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    id: Math.random().toString(36),
    aspect: 'profile',
    severity: 'error',
    code: 'profile-slice-min-cardinality',
    message: 'missing slice',
    path: 'Observation.referenceRange',
    timestamp: new Date(),
    ...overrides,
  } as ValidationIssue;
}

describe('dedupeIssues', () => {
  it('preserves distinct slice issues on the same path', () => {
    const deduped = dedupeIssues([
      issue({ ruleId: 'slice-min-Slice1', details: { sliceName: 'Slice1' } }),
      issue({ ruleId: 'slice-min-Slice2', details: { sliceName: 'Slice2' } }),
      issue({ ruleId: 'slice-min-Slice1', details: { sliceName: 'Slice1' } }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map(i => i.ruleId)).toEqual([
      'slice-min-Slice1',
      'slice-min-Slice2',
    ]);
  });

  it('dedupes equivalent resource-prefixed and relative paths', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'terminology-code-invalid',
        severity: 'warning',
        path: 'Organization.meta.tag',
        resourceType: 'Organization',
        details: { resourceType: 'Organization' },
      }),
      issue({
        code: 'terminology-code-invalid',
        severity: 'warning',
        path: 'meta.tag',
        resourceType: 'Organization',
        details: { resourceType: 'Organization' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
  });
});
