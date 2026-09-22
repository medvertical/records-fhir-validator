import type { ValidationIssue } from '@records-fhir/validation-types';

export function getDetailsRecord(issue: ValidationIssue): Record<string, unknown> | undefined {
  const details = issue.details;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
}

export function getIssuePath(issue: ValidationIssue): string {
  const details = getDetailsRecord(issue);
  const detailPath = details?.fieldPath ?? details?.element;
  return typeof detailPath === 'string' && detailPath.length > 0
    ? detailPath
    : issue.path ?? '';
}

export function getIssueResourceType(issue: ValidationIssue): string {
  const detailResourceType = getDetailsRecord(issue)?.resourceType;
  if (typeof issue.resourceType === 'string' && issue.resourceType.length > 0) {
    return issue.resourceType;
  }
  if (typeof detailResourceType === 'string' && detailResourceType.length > 0) {
    return detailResourceType;
  }
  return getIssuePath(issue).trim().match(/^([A-Z][A-Za-z0-9]+)\./)?.[1] ?? '';
}
