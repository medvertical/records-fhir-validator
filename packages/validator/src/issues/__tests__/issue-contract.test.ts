import { describe, expect, it } from 'vitest';
import {
  issueFingerprint,
  issueMatchesAnchor,
  issuePathMatchesPattern,
  stableIssues,
  summarizeIssueAnchors,
  summarizeIssueFingerprints,
  type ExpectedIssueAnchor,
} from '../issue-contract';
import type { ValidationIssue } from '../../types';

const issue: ValidationIssue = {
  aspect: 'profile',
  severity: 'error',
  message: 'Required field missing',
  code: 'required-field-missing',
  path: 'Patient.name[0].family',
};

describe('issue contract helpers', () => {
  it('matches literal, wildcard, and subtree path patterns', () => {
    expect(issuePathMatchesPattern('Patient.name[0].family', 'Patient.name[0].family')).toBe(true);
    expect(issuePathMatchesPattern('Patient.name[0].family', 'Patient.name*.family')).toBe(true);
    expect(issuePathMatchesPattern('Patient.name[0].family', 'Patient.name[0].*')).toBe(true);
    expect(issuePathMatchesPattern('Patient.name[0].given', 'Patient.name[0].family')).toBe(false);
  });

  it('matches issue anchors by severity, code prefix, and path pattern', () => {
    const expected: ExpectedIssueAnchor = {
      severity: 'error',
      kind: 'required',
      pathPattern: 'Patient.name[0].*',
    };

    expect(issueMatchesAnchor(issue, expected)).toBe(true);
    expect(issueMatchesAnchor(issue, { ...expected, severity: 'warning' })).toBe(false);
    expect(issueMatchesAnchor(issue, { ...expected, kind: 'terminology' })).toBe(false);
    expect(issueMatchesAnchor(issue, { ...expected, pathPattern: 'Observation.*' })).toBe(false);
  });

  it('allows a code hint to override the fixture kind', () => {
    expect(issueMatchesAnchor(issue, {
      severity: 'error',
      kind: 'must-support',
      codeHint: 'required-field',
      pathPattern: 'Patient.name[0].family',
    })).toBe(true);
  });

  it('filters unstable fallback issues from stable summaries', () => {
    const issues: ValidationIssue[] = [
      issue,
      {
        aspect: 'structural',
        severity: 'error',
        message: 'Internal fallback',
        code: 'validation-error',
      },
    ];

    expect(stableIssues(issues)).toEqual([issue]);
    expect(summarizeIssueAnchors(issues)).toBe('error required-field-missing Patient.name[0].family');
  });

  it('fingerprints stable issue identity rather than wording', () => {
    const sameIdentityDifferentWording: ValidationIssue = {
      ...issue,
      id: 'different-generated-id',
      message: 'Clearer wording after a diagnostics improvement',
      details: { expected: 'family' },
      timestamp: '2026-06-23T00:00:00.000Z',
    };

    expect(issueFingerprint(sameIdentityDifferentWording)).toBe(issueFingerprint(issue));
    expect(issueFingerprint({ ...issue, path: 'Patient.birthDate' })).not.toBe(issueFingerprint(issue));
    expect(issueFingerprint({ ...issue, profile: 'http://example.org/Profile' })).not.toBe(issueFingerprint(issue));
    expect(issueFingerprint({ ...issue, ruleId: 'pat-1' })).not.toBe(issueFingerprint(issue));
  });

  it('summarizes fingerprints for stable regression snapshots', () => {
    const summary = summarizeIssueFingerprints([
      issue,
      {
        aspect: 'general',
        severity: 'error',
        message: 'Internal fallback',
        code: 'validation-error',
      },
    ]);

    expect(summary).toContain('error required-field-missing Patient.name[0].family');
    expect(summary).not.toContain('validation-error');
  });
});
