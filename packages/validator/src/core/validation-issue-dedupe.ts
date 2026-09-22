import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeIssuePathForDedupe } from './validation-issue-dedupe-constraints.js';
import { collectDedupeContext } from './validation-issue-dedupe-context.js';
import {
  createDedupeSuppressionRules,
  getSuppressionRuleId,
} from './validation-issue-dedupe-rules.js';
import {
  getIssuePath,
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-utils.js';
import { getEffectiveRuleId } from './validation-issue-dedupe-profile-signals.js';
import {
  hasBundleEntryResourceIdentity,
  isIndexedBundleEntryResourcePath,
} from './validation-issue-dedupe-bundle-path-utils.js';

/**
 * Dedupe issues by (code, path, severity, rule). Prevents reporting the same
 * constraint violation (e.g. dom-6) multiple times when several validators
 * independently re-check the same rule, while preserving distinct slice
 * cardinality failures that legitimately share one base path.
 */
export function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return dedupeIssuesWithTrace(issues).issues;
}

/**
 * Remove only logically identical diagnostics without applying cross-code
 * suppression. This is used when independently validated child resources are
 * appended after the parent's semantic suppression pass: re-running semantic
 * suppression over the combined list can create cycles where two legitimate
 * representations suppress each other.
 */
export function dedupeExactIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const positions = new Map<string, number>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = getSemanticDedupeKey(issue, getIssueRuleKey(issue));
    const existingPosition = positions.get(key);
    if (existingPosition !== undefined) {
      if (preferRebasedBundleEntryIssue(issue, out[existingPosition])) {
        out[existingPosition] = issue;
      }
      continue;
    }
    positions.set(key, out.length);
    out.push(issue);
  }
  return out;
}

function preferRebasedBundleEntryIssue(
  candidate: ValidationIssue,
  existing: ValidationIssue,
): boolean {
  return hasBundleEntryResourceIdentity(candidate.path ?? '')
    && !hasBundleEntryResourceIdentity(existing.path ?? '');
}

/**
 * Final resource-tree cleanup after recursively validated contained resources
 * have been appended. Keep this deliberately narrower than the normal
 * semantic suppression pass: only exact copies and the known parent/child
 * canonical-URI duplicate are removed.
 */
export function dedupeResourceTreeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const exact = issues.filter(issue => {
    const key = [
      issue.code,
      normalizeResourceTreePath(issue),
      issue.severity,
      getResourceTreeRuleKey(issue),
      issue.message,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const specificCanonicalPaths = new Set(
    exact
      .filter(issue => issue.code === 'tx-codesystem-url-not-absolute')
      .map(normalizeResourceTreePath),
  );
  return exact.filter(issue =>
    issue.code !== 'structural-invalid-uri' ||
    !specificCanonicalPaths.has(normalizeResourceTreePath(issue))
  );
}

export interface DedupeSuppressionTrace {
  readonly ruleId: string;
  readonly issue: ValidationIssue;
}

export interface DedupeIssuesResult {
  readonly issues: ValidationIssue[];
  readonly suppressions: DedupeSuppressionTrace[];
}

export function dedupeIssuesWithTrace(issues: ValidationIssue[]): DedupeIssuesResult {
  const semanticResult = suppressSemanticIssuesWithTrace(issues);
  return {
    issues: dedupeExactIssues(semanticResult.issues),
    suppressions: semanticResult.suppressions,
  };
}

/**
 * Apply only cross-issue semantic suppression. Exact/logical identity remains
 * the responsibility of callers such as the persistence layer.
 */
export function suppressSemanticIssuesWithTrace(issues: ValidationIssue[]): DedupeIssuesResult {
  const rules = createDedupeSuppressionRules(collectDedupeContext(issues));
  const retained: ValidationIssue[] = [];
  const suppressions: DedupeSuppressionTrace[] = [];

  for (const issue of issues) {
    const ruleId = getSuppressionRuleId(issue, rules);
    if (ruleId) {
      suppressions.push({ ruleId, issue });
    } else {
      retained.push(issue);
    }
  }
  return { issues: retained, suppressions };
}

function getIssueRuleKey(issue: ValidationIssue): string {
  const details = getIssueDetails(issue);
  const detailRuleKey = details
    ? [
      details.constraintKey ?? details.sliceName,
      details.sourceProfile,
    ].filter(isNonEmptyString).join(':')
    : undefined;
  return [getEffectiveRuleId(issue), detailRuleKey]
    .filter(isNonEmptyString)
    .join(':');
}

function getResourceTreeRuleKey(issue: ValidationIssue): string {
  const details = getIssueDetails(issue);
  const detailRuleKey = details?.constraintKey ?? details?.sliceName;
  return [getEffectiveRuleId(issue), detailRuleKey]
    .filter(isNonEmptyString)
    .join(':');
}

function getIssueDetails(issue: ValidationIssue): Record<string, unknown> | undefined {
  const { details } = issue;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeResourceTreePath(issue: ValidationIssue): string {
  return (issue.path || getIssuePath(issue))
    .trim()
    .replace(/\/\*[^*]*\*\//g, '')
    .replace(/\.+/g, '.')
    .replace(/\.$/, '')
    .toLowerCase();
}

function getSemanticDedupeKey(issue: ValidationIssue, ruleKey: string): string {
  const pathKey = issue.code === 'profile-mustsupport-missing'
    ? normalizeRequiredElementPath(issue)
    : normalizeIssuePathForDedupe(issue);
  const severityKey = issue.severity === 'information'
    ? 'info'
    : issue.severity;
  if (issue.code === 'dom-6') {
    return `${issue.code}:${pathKey}:${severityKey}`;
  }
  // A single Narrative.div can contain several broken fragment links. They
  // share code, severity, and path but point at different targets, so each is
  // a distinct actionable finding rather than a duplicate validator report.
  if (issue.code === 'narrative-hyperlink-target-not-found') {
    const targetId = getIssueDetails(issue)?.targetId;
    return `${issue.code}:${pathKey}:${severityKey}:${String(targetId ?? issue.message)}`;
  }
  // Reference target validation can legitimately produce two findings at the
  // same Reference element: the declared Reference.type may be disallowed,
  // and the resolved target may independently disagree with that declaration.
  if (issue.code === 'reference-target-type-invalid') {
    const details = getIssueDetails(issue);
    const allowedTargets = Array.isArray(details?.allowedTargets)
      ? details.allowedTargets.join('|')
      : '';
    return [
      issue.code,
      pathKey,
      severityKey,
      details?.reason ?? '',
      details?.actualTarget ?? '',
      details?.declaredTargetType ?? '',
      allowedTargets,
    ].join(':');
  }
  // A required child can be discovered both by the structural snapshot walk
  // and by the matched-slice content walk. The latter adds `sliceName` to the
  // rule key, but both diagnostics still describe the same missing value at
  // the same concrete instance path. Keep one row while preserving distinct
  // cardinalities/messages at that path.
  if (issue.code === 'structural-cardinality-min') {
    return getCardinalityDedupeKey(issue, pathKey, severityKey);
  }
  // Generic HL7 issue codes (and other diagnostics without an explicit rule)
  // can legitimately describe multiple failures at the same element. The
  // message is their only rule identity; omitting it collapsed, for example,
  // a missing contained-resource id and an unreferenced-contained dom-3 error
  // into one `invalid` issue at the same normalized path.
  const effectiveRuleKey = ruleKey || issue.message;
  return `${issue.code}:${pathKey}:${severityKey}:${effectiveRuleKey}`;
}

function getCardinalityDedupeKey(
  issue: ValidationIssue,
  pathKey: string,
  severityKey: string,
): string {
  if (!isIndexedBundleEntryResourcePath(issue.path ?? '')) {
    return `${issue.code}:${pathKey}:${severityKey}:${issue.message}`;
  }
  const details = getIssueDetails(issue);
  const expectedMin = details?.expectedMin ?? details?.min ?? '';
  const actualCount = details?.actualCount ?? details?.actual ?? '';
  return `${issue.code}:${pathKey}:${severityKey}:${expectedMin}:${actualCount}`;
}
