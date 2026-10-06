import type { ValidationIssue } from '@records-fhir/validation-types';

const REPEAT_INDEX = /\[\d+\]/g;

/**
 * A slice-scoped binding check names the element (`Patient.identifier.type`),
 * not the repeat it judged. When the same finding also stands at a repeat's
 * own path (`Patient.identifier[0].type`), the element-level copy says it
 * twice; a finding of another value set keeps its own message and stays.
 */
export function withoutElementLevelBindingDuplicates(issues: ValidationIssue[]): ValidationIssue[] {
  const atRepeats = new Set(issues
    .filter(issue => isBindingFinding(issue) && isRepeatPath(issue.path))
    .map(issue => findingKey(issue, (issue.path ?? '').replace(REPEAT_INDEX, ''))));
  if (atRepeats.size === 0) return issues;
  return issues.filter(issue => !(isBindingFinding(issue) && issue.path && !isRepeatPath(issue.path)
    && atRepeats.has(findingKey(issue, issue.path))));
}

function isBindingFinding(issue: ValidationIssue): boolean {
  return (issue.code?.startsWith('terminology-binding-') ?? false) || issue.code === 'terminology-system-undetermined';
}

function isRepeatPath(path: string | undefined): boolean {
  return /\[\d+\]/.test(path ?? '');
}

function findingKey(issue: ValidationIssue, path: string): string {
  return `${issue.code}\u0000${issue.message}\u0000${path}`;
}
