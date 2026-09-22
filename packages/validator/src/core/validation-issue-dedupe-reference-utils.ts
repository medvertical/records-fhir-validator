import type { ValidationIssue } from '@records-fhir/validation-types';
import { getDetailsRecord, getIssuePath } from './validation-issue-dedupe-common.js';

export function getIssueReferenceValue(issue: ValidationIssue): string | null {
  const reference = getDetailsRecord(issue)?.reference;
  return typeof reference === 'string' && reference.trim().length > 0
    ? reference.trim().toLowerCase()
    : null;
}

export function getBundleReferenceIssueKey(issue: ValidationIssue): string | null {
  const reference = getIssueReferenceValue(issue);
  if (!reference) return null;
  const entryIndex = (getIssuePath(issue) || issue.path || '').match(/Bundle\.entry\[(\d+)\]/i)?.[1];
  return entryIndex ? `${entryIndex}:${reference}` : null;
}

export function normalizeBundleRequestPath(issue: ValidationIssue): string {
  return getIssuePath(issue)
    .trim()
    .toLowerCase()
    .replace(/^bundle\./, '')
    .replace(/\.$/, '');
}
