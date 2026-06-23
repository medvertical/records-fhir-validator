import { describe, expect, it } from 'vitest';
import {
  buildValidationIssueProvenance,
  inferValidationIssueSourceExecutor,
} from '../issue-provenance';

describe('validation issue provenance', () => {
  it('preserves raw and canonical codes for normalized issue taxonomy', () => {
    expect(buildValidationIssueProvenance({
      rawCode: 'invalid',
      canonicalCode: 'terminology-coding-system-valueset',
      ruleId: null,
      profile: 'http://example.test/Profile',
    })).toEqual({
      rawCode: 'invalid',
      canonicalCode: 'terminology-coding-system-valueset',
      sourceExecutor: 'terminology',
      profile: 'http://example.test/Profile',
      verification: 'verified',
      confidence: 'high',
    });
  });

  it('classifies terminology coverage gaps as medium-confidence unverified issues', () => {
    expect(buildValidationIssueProvenance({
      rawCode: 'terminology-code-invalid',
      canonicalCode: 'terminology-codesystem-unresolvable',
      message: 'CodeSystem could not be validated',
    })).toEqual(expect.objectContaining({
      sourceExecutor: 'terminology',
      verification: 'unverified',
      confidence: 'medium',
    }));
  });

  it('infers source executor from aspect before code heuristics', () => {
    expect(inferValidationIssueSourceExecutor({
      aspect: 'profile',
      canonicalCode: 'binding-required-missing',
    })).toBe('profile');
  });

  it('infers source executor from known issue code families', () => {
    expect(inferValidationIssueSourceExecutor({ canonicalCode: 'reference-not-found' })).toBe('reference');
    expect(inferValidationIssueSourceExecutor({ canonicalCode: 'profile-slice-min-cardinality' })).toBe('profile');
    expect(inferValidationIssueSourceExecutor({ canonicalCode: 'structural-cardinality-min' })).toBe('structural');
  });
});
