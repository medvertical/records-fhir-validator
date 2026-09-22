import type { ValidationIssue } from '@records-fhir/validation-types';

const ROOT_SERVER_MANAGED_METADATA_PATH = /^[A-Z][A-Za-z0-9]*\.meta\.(?:lastUpdated|versionId)$/;

export function shouldSuppressServerManagedMetadataIssue(issue: ValidationIssue): boolean {
  const path = getIssuePath(issue);
  return issue.aspect === 'structural' &&
    issue.code === 'structural-cardinality-max' &&
    ROOT_SERVER_MANAGED_METADATA_PATH.test(path);
}

function getIssuePath(issue: ValidationIssue): string {
  if (typeof issue.path === 'string' && issue.path.length > 0) {
    return issue.path;
  }
  const details = issue.details;
  const detailPath = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).fieldPath
    : undefined;
  return typeof detailPath === 'string' ? detailPath : '';
}
