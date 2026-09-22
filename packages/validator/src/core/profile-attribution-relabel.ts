import { computeValidationIssueId } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

/**
 * Shared relabeling for findings produced by a silently substituted profile SD
 * (code-inferred or declared): structural findings move to the profile aspect,
 * provenance lands in details, and the identity hash is recomputed. The
 * finding itself — code, message, path, severity — never changes.
 */
export function relabelProfileImposedIssue(
  issue: ValidationIssue,
  profileUrl: string,
  provenance: Record<string, unknown>,
): ValidationIssue {
  const relabeled: ValidationIssue = {
    ...issue,
    aspect: issue.aspect === 'structural' ? 'profile' : issue.aspect,
    profile: issue.profile ?? profileUrl,
    details: withProfileProvenanceDetails(issue.details, { ...provenance, profileAttribution: 'rule' }),
  };
  return { ...relabeled, id: computeIssueIdentity(relabeled) };
}

/** Best-practice hints are labeled structural but do not stem from the profile. */
export function isBestPracticeIssue(issue: ValidationIssue): boolean {
  const structuredDetails = typeof issue.details === 'object' && issue.details !== null
    ? issue.details
    : undefined;
  return structuredDetails?.bestPractice === true
    || (Array.isArray(issue.tags) && issue.tags.includes('best-practice'));
}

export function withProfileProvenanceDetails(
  details: ValidationIssue['details'],
  provenance: Record<string, unknown>,
): Record<string, unknown> {
  const structuredDetails = typeof details === 'object' && details !== null
    ? details
    : typeof details === 'string' ? { text: details } : {};
  return { ...structuredDetails, ...provenance };
}

export function computeIssueIdentity(issue: ValidationIssue): string {
  return computeValidationIssueId({
    aspect: issue.aspect,
    severity: issue.severity,
    code: issue.code,
    path: issue.path,
    resourceType: issue.resourceType,
    message: issue.message,
    profile: issue.profile,
    ruleId: issue.ruleId,
    details: issue.details,
  });
}
