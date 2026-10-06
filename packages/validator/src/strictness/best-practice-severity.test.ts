import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { applyBestPracticeSeverity } from './best-practice-severity';

const issue = (code: string, severity: ValidationIssue['severity'], extra: Partial<ValidationIssue> = {}) =>
  ({ aspect: 'profile', code, severity, message: code, ...extra }) as ValidationIssue;

describe('best-practice severity', () => {
  // The reference validator reports dom-6 and its best-practice advice as warnings.
  it('keeps best practices informational by default and reports warnings on request', () => {
    const issues = [
      issue('dom-6', 'information'),
      issue('best-practice-missing-performer', 'information', { details: { bestPractice: true } }),
      issue('profile-constraint-warning', 'warning'),
    ];

    expect(applyBestPracticeSeverity(issues, undefined).map(item => item.severity)).toEqual(['information', 'information', 'warning']);
    expect(applyBestPracticeSeverity(issues, 'info').map(item => item.severity)).toEqual(['information', 'information', 'warning']);
    expect(applyBestPracticeSeverity(issues, 'warning').map(item => item.severity)).toEqual(['warning', 'warning', 'warning']);
  });

  it('keeps a best practice strict mode escalated to an error', () => {
    expect(applyBestPracticeSeverity([issue('dom-6', 'error')], 'info')[0].severity).toBe('error');
  });
});
