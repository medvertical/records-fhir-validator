import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeRequiredElementPath } from './validation-issue-dedupe-utils.js';

export function getRequiredBindingViolationKey(issue: ValidationIssue): string | null {
  if (
    issue.code !== 'profile-required-binding-violation'
    && issue.code !== 'terminology-binding-required'
    && issue.code !== 'terminology-binding-required-code'
  ) return null;
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const valueSet = (details as Record<string, unknown>).valueSet;
  if (typeof valueSet !== 'string' || valueSet.length === 0) return null;
  return `${normalizeRequiredElementPath(issue)}|${valueSet}`;
}

export function isRedundantProfileRequiredBindingIssue(
  issue: ValidationIssue,
  terminologyRequiredBindingKeys: Set<string>,
): boolean {
  if (issue.code !== 'profile-required-binding-violation') return false;
  const key = getRequiredBindingViolationKey(issue);
  return Boolean(key && terminologyRequiredBindingKeys.has(key));
}

export function isRedundantTerminologyNotFoundIssue(
  issue: ValidationIssue,
  invalidUriPaths: Set<string>,
  invalidTerminologySystemPaths: Set<string>,
): boolean {
  if (invalidUriPaths.size === 0 && invalidTerminologySystemPaths.size === 0) return false;
  if (issue.code !== 'not-found' && issue.code !== 'terminology-codesystem-unresolvable') return false;
  const path = normalizeRequiredElementPath(issue);
  return invalidUriPaths.has(path) || invalidTerminologySystemPaths.has(path);
}

export function isTerminologySystemInvalidIssue(issue: ValidationIssue): boolean {
  return issue.code === 'terminology-code-invalid'
    && normalizeRequiredElementPath(issue).endsWith('.system');
}
