import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeRequiredElementPath } from './validation-issue-dedupe-utils.js';

export function isRedundantBestPracticePresenceIssue(
  issue: ValidationIssue,
  cardinalityMinPaths: Set<string>,
): boolean {
  if (cardinalityMinPaths.size === 0) return false;
  if (!issue.code?.startsWith('best-practice-')) return false;
  return cardinalityMinPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantRequiredBindingIssue(
  issue: ValidationIssue,
  cardinalityMinPaths: Set<string>,
): boolean {
  if (cardinalityMinPaths.size === 0) return false;
  if (issue.code !== 'binding-required-missing' && issue.code !== 'terminology-binding-missing') return false;
  return cardinalityMinPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantProfileExtensionCardinalityIssue(
  issue: ValidationIssue,
  profileExtensionMinPaths: Set<string>,
): boolean {
  if (profileExtensionMinPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  return profileExtensionMinPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantProfileSliceCardinalityIssue(
  issue: ValidationIssue,
  profileSliceMinPaths: Set<string>,
): boolean {
  if (profileSliceMinPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  return profileSliceMinPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantExtensionSliceMaxIssue(
  issue: ValidationIssue,
  extensionMaxKeys: Set<string>,
): boolean {
  if (issue.code !== 'profile-slice-max-cardinality') return false;
  const key = getExtensionMaxCardinalityKey(issue);
  return Boolean(key && extensionMaxKeys.has(key));
}

export function getExtensionMaxCardinalityKey(issue: ValidationIssue): string | null {
  if (issue.code !== 'profile-extension-max-cardinality' && issue.code !== 'profile-slice-max-cardinality') return null;
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  const rawName = issue.code === 'profile-extension-max-cardinality'
    ? record.url
    : (record.sliceName ?? record.slice);
  if (typeof rawName !== 'string' || rawName.trim().length === 0) return null;
  const normalizedName = rawName.split('/').filter(Boolean).pop()?.toLowerCase();
  if (!normalizedName) return null;
  const max = record.max;
  const found = record.found ?? record.actual;
  return [normalizeRequiredElementPath(issue), normalizedName, String(max ?? ''), String(found ?? '')].join('|');
}

export function isRedundantMustSupportBestPracticeIssue(
  issue: ValidationIssue,
  mustSupportPaths: Set<string>,
): boolean {
  if (!issue.code?.startsWith('best-practice-')) return false;
  return mustSupportPaths.has(normalizeRequiredElementPath(issue));
}
