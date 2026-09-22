import type { ValidationIssue } from '@records-fhir/validation-types';
import { getIssuePath, normalizeRequiredElementPath } from './validation-issue-dedupe-utils.js';

export function isRedundantPresenceInvariantIssue(issue: ValidationIssue, requiredBindingViolationPaths: Set<string>): boolean {
  if (requiredBindingViolationPaths.size === 0) return false;
  if (issue.code !== 'ait-1-violation') return false;
  return requiredBindingViolationPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantExtensionConstraintIssue(issue: ValidationIssue, extensionNoValuePaths: Set<string>): boolean {
  if (extensionNoValuePaths.size === 0) return false;
  if (issue.code !== 'profile-constraint-violation') return false;
  const details = issue.details;
  const constraintKey = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).constraintKey
    : undefined;
  if (constraintKey !== 'ext-1') return false;
  return extensionNoValuePaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantContainedUnreferencedIssue(
  issue: ValidationIssue,
  containedInvalidPaths: Set<string>,
): boolean {
  if (containedInvalidPaths.size === 0) return false;
  if (issue.code !== 'contained-unreferenced') return false;
  return containedInvalidPaths.has(normalizeRequiredElementPath(issue));
}

export function isContainedUnreferencedInvalidIssue(issue: ValidationIssue): boolean {
  // 'invalid' still matches pass-through issues from engines that emit the
  // generic HL7 code; Records' own check now uses the specific code.
  if (issue.code !== 'invalid' && issue.code !== 'structural-contained-not-referenced') return false;
  const message = issue.message?.toLowerCase() ?? '';
  if (!message.includes('contained resource') || !message.includes('not referenced')) return false;
  return normalizeRequiredElementPath(issue).includes('contained');
}

export function isRedundantProfileDom3Issue(issue: ValidationIssue, structuralDom3ContainedKeys: Set<string>): boolean {
  if (structuralDom3ContainedKeys.size === 0) return false;
  const key = getProfileDom3ContainedIssueKey(issue);
  return Boolean(key && structuralDom3ContainedKeys.has(key));
}

export function getStructuralDom3ContainedIssueKey(issue: ValidationIssue): string | null {
  if (!isContainedUnreferencedInvalidIssue(issue)) return null;
  return getContainedUnreferencedIssueKey(issue);
}

function getProfileDom3ContainedIssueKey(issue: ValidationIssue): string | null {
  if (issue.code !== 'profile-constraint-violation' && issue.code !== 'profile-constraint-warning') return null;
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  if ((details as Record<string, unknown>).constraintKey !== 'dom-3') return null;
  return getContainedUnreferencedIssueKey(issue);
}

function getContainedUnreferencedIssueKey(issue: ValidationIssue): string | null {
  const containedId = getContainedResourceId(issue);
  if (!containedId) return null;
  return [getContainedIssueResourceScope(issue), normalizeContainedParentPath(issue), containedId.toLowerCase()].join(':');
}

function getContainedResourceId(issue: ValidationIssue): string | null {
  const details = issue.details;
  const detailContainedId = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).containedId
    : undefined;
  if (typeof detailContainedId === 'string' && detailContainedId.trim().length > 0) {
    return detailContainedId.trim();
  }
  const containedId = issue.message?.match(/contained resource ['"]([^'"]+)['"]/i)?.[1]?.trim();
  return containedId && containedId.length > 0 ? containedId : null;
}

function getContainedIssueResourceScope(issue: ValidationIssue): string {
  const details = issue.details;
  const record = details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
  const resourceType = typeof issue.resourceType === 'string'
    ? issue.resourceType
    : typeof record?.resourceType === 'string' ? record.resourceType : '';
  return resourceType.trim().toLowerCase();
}

function normalizeContainedParentPath(issue: ValidationIssue): string {
  return getIssuePath(issue)
    .trim()
    .replace(/\.contained(?:\[\d+\])?(?:\..*)?$/i, '')
    .replace(/\.$/, '')
    .toLowerCase();
}
