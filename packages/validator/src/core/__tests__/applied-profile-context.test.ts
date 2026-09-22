import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { attachAppliedProfile } from '../multi-aspect-contained-validation';

const issue: ValidationIssue = { aspect: 'metadata', severity: 'information', code: 'missing-meta', path: 'meta', message: 'Resource should have a meta field' };

describe('applied profile attribution', () => {
  it('records a fallback as validation context without changing the rule category', () => {
    const result = attachAppliedProfile(issue, 'https://example.test/Patient');
    expect(result.aspect).toBe('metadata');
    expect(result.profile).toBe('https://example.test/Patient');
    expect(result.details?.profileAttribution).toBe('validation-context');
    expect(issue.profile).toBeUndefined();
  });
  it('preserves an explicit rule profile', () => {
    const attributed = { ...issue, profile: 'https://example.test/RuleSource' };
    expect(attachAppliedProfile(attributed, 'https://example.test/Patient')).toBe(attributed);
  });
});
