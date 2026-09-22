import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  getInvalidUriIssueKey,
  getTerminologyCodeInvalidKey,
  getTerminologyDisplayMismatchKey,
} from './validation-issue-dedupe-utils.js';

export function isRedundantInvalidUriIssue(
  issue: ValidationIssue,
  preferredIssues: Map<string, ValidationIssue>,
): boolean {
  const key = getInvalidUriIssueKey(issue);
  if (!key) return false;
  const preferred = preferredIssues.get(key);
  return Boolean(preferred && preferred !== issue);
}

export function isRedundantTerminologyDisplayMismatchIssue(
  issue: ValidationIssue,
  preferredIssues: Map<string, ValidationIssue>,
): boolean {
  const key = getTerminologyDisplayMismatchKey(issue);
  if (!key) return false;
  const preferred = preferredIssues.get(key);
  return Boolean(preferred && preferred !== issue);
}

export function isRedundantTerminologyCodeInvalidIssue(
  issue: ValidationIssue,
  preferredIssues: Map<string, ValidationIssue>,
): boolean {
  const key = getTerminologyCodeInvalidKey(issue);
  if (!key) return false;
  const preferred = preferredIssues.get(key);
  return Boolean(preferred && preferred !== issue);
}
