import type { ValidationIssue } from '../types';
import { computeValidationIssueId } from '@records-fhir/validation-types';

export interface ExpectedIssueAnchor {
  severity: ValidationIssue['severity'];
  kind: string;
  pathPattern: string;
  codeHint?: string;
}

export interface StableIssueSummaryOptions {
  ignoredCodes?: string[];
}

const DEFAULT_IGNORED_CODES = ['validation-error'];

export function issuePathMatchesPattern(actualPath: string | undefined, pattern: string): boolean {
  const path = actualPath ?? '';
  if (pattern.endsWith('.*')) {
    return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
  }

  const source = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${source}$`).test(path);
}

export function issueMatchesAnchor(issue: ValidationIssue, expected: ExpectedIssueAnchor): boolean {
  const code = issue.code ?? '';
  const expectedCode = expected.codeHint ?? expected.kind;
  return issue.severity === expected.severity
    && code.startsWith(expectedCode)
    && issuePathMatchesPattern(issue.path, expected.pathPattern);
}

export function stableIssues(
  issues: ValidationIssue[],
  options: StableIssueSummaryOptions = {},
): ValidationIssue[] {
  const ignoredCodes = options.ignoredCodes ?? DEFAULT_IGNORED_CODES;
  return issues.filter(issue => !ignoredCodes.includes(issue.code ?? ''));
}

export function summarizeIssueAnchors(
  issues: ValidationIssue[],
  options: StableIssueSummaryOptions = {},
): string {
  return stableIssues(issues, options)
    .map(issue => `${issue.severity} ${issue.code} ${issue.path ?? '<resource>'}`)
    .sort()
    .join('\n');
}

/**
 * Stable contract fingerprint for grouping and regression tests.
 *
 * Unlike ValidationIssue.id, this intentionally excludes message text, details,
 * timestamps, and generated ids. Those fields may change when diagnostics get
 * clearer; the fingerprint only tracks the issue identity consumers rely on.
 */
export function issueFingerprint(issue: ValidationIssue): string {
  return computeValidationIssueId({
    aspect: issue.aspect,
    severity: issue.severity,
    code: issue.code,
    path: issue.path,
    resourceType: typeof issue.resourceType === 'string' ? issue.resourceType : undefined,
    profile: typeof issue.profile === 'string' ? issue.profile : undefined,
    ruleId: typeof issue.ruleId === 'string' ? issue.ruleId : undefined,
  });
}

export function summarizeIssueFingerprints(
  issues: ValidationIssue[],
  options: StableIssueSummaryOptions = {},
): string {
  return stableIssues(issues, options)
    .map(issue => `${issueFingerprint(issue)} ${issue.severity} ${issue.code ?? '<code>'} ${issue.path ?? '<resource>'}`)
    .sort()
    .join('\n');
}
