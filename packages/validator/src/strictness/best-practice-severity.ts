import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';

/**
 * Best-practice findings (dom-6's narrative, the recommendations the
 * reference validator adds as best practice) take the severity the settings
 * give them. They stay informational by default, so datasets without
 * narratives keep their quality scores; `warning` reports them as the
 * reference validator does. Errors that strict mode escalated stay errors.
 */
export function applyBestPracticeSeverity(
  issues: ValidationIssue[],
  configured: ValidationSettings['bestPracticeSeverity'],
): ValidationIssue[] {
  const severity = configured === 'warning' ? 'warning' : 'information';
  return issues.map(issue => (isBestPracticeIssue(issue) && isAdvisory(issue.severity) && issue.severity !== severity
    ? { ...issue, severity }
    : issue));
}

function isBestPracticeIssue(issue: ValidationIssue): boolean {
  const details = typeof issue.details === 'object' ? issue.details : undefined;
  return issue.code === 'dom-6' || details?.bestPractice === true || (issue.tags ?? []).includes('best-practice');
}

function isAdvisory(severity: ValidationIssue['severity']): boolean {
  return severity === 'warning' || severity === 'information' || severity === 'info';
}
