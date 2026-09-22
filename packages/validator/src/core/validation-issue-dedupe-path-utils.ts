import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeChoiceTypePath } from './choice-type-path.js';
import { getDetailsRecord, getIssuePath } from './validation-issue-dedupe-common.js';

export function isSliceSpecificMustSupportIssue(issue: ValidationIssue): boolean {
  if (issue.code !== 'profile-mustsupport-missing') return false;
  const sliceName = getDetailsRecord(issue)?.sliceName;
  return (typeof sliceName === 'string' && sliceName.length > 0) || getIssuePath(issue).includes(':');
}

export function getScopedMustSupportPath(issue: ValidationIssue): string {
  return [getMustSupportResourceScope(issue), normalizeRequiredElementPath(issue)].join(':');
}

function getMustSupportResourceScope(issue: ValidationIssue): string {
  const details = getDetailsRecord(issue);
  const bundleUnit = details?.bundleUnit && typeof details.bundleUnit === 'object'
    && !Array.isArray(details.bundleUnit)
    ? details.bundleUnit as Record<string, unknown>
    : undefined;
  const entryIndex = bundleUnit?.entryIndex;
  const resourceType = typeof issue.resourceType === 'string'
    ? issue.resourceType
    : typeof details?.resourceType === 'string'
      ? details.resourceType
      : typeof bundleUnit?.resourceType === 'string' ? bundleUnit.resourceType : '';
  const resourceId = typeof bundleUnit?.resourceId === 'string' ? bundleUnit.resourceId : '';
  const profile = typeof issue.profile === 'string'
    ? issue.profile
    : typeof details?.sourceProfile === 'string' ? details.sourceProfile : '';
  if (typeof entryIndex === 'number' || typeof entryIndex === 'string') {
    return `${profile}|entry:${entryIndex}|${resourceType}|${resourceId}`;
  }
  return `${profile}|${resourceType}|${resourceId}`;
}

export function normalizeRequiredElementPath(issue: ValidationIssue): string {
  return normalizeChoiceTypePath(getIssuePath(issue)
    .replace(/\[\d+\]/g, '')
    .replace(/:[^.]+/g, '')
    .replace(/^[A-Z][A-Za-z0-9]*\./, ''));
}

export function getQuestionnaireAnswerOptionDisallowedPath(issue: ValidationIssue): string | null {
  if (issue.code !== 'questionnaire-invariant-que-5') return null;
  const path = normalizeQuestionnairePathWithIndices(issue);
  return path.includes('.answeroption') ? null : path;
}

export function normalizeQuestionnairePathWithIndices(issue: ValidationIssue): string {
  return getIssuePath(issue)
    .trim()
    .replace(/^[A-Z][A-Za-z0-9]*\./, '')
    .replace(/:[^.]+/g, '')
    .replace(/\.+/g, '.')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function normalizeInvalidUriDedupePath(issue: ValidationIssue): string {
  return normalizeChoiceTypePath(getIssuePath(issue)
    .replace(/\[\d+\]/g, '')
    .replace(/\[(?!x\])[^\]]+\]/gi, '')
    .replace(/:[^.]+/g, '')
    .replace(/^[A-Z][A-Za-z0-9]*\./, '')
    .trim()
    .toLowerCase());
}

export function getInvalidQuestionnaireCanonicalReferenceKey(issue: ValidationIssue): string | null {
  if (issue.code !== 'structural-invalid-uri') return null;
  if (normalizeInvalidUriDedupePath(issue) !== 'questionnaire') return null;
  const value = getDetailsRecord(issue)?.value;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

export function getInvalidProfileCanonicalValue(issue: ValidationIssue): string | null {
  if (issue.code !== 'structural-invalid-uri') return null;
  if (normalizeInvalidUriDedupePath(issue) !== 'meta.profile') return null;
  const value = getDetailsRecord(issue)?.value;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

export function isRedundantProfileNotResolvedWarning(
  issue: ValidationIssue,
  invalidProfileCanonicalValues: Set<string>,
): boolean {
  if (issue.code !== 'profile-not-resolved' || invalidProfileCanonicalValues.size === 0) return false;
  const profile = getDetailsRecord(issue)?.profile;
  return typeof profile === 'string'
    && invalidProfileCanonicalValues.has(profile.trim().toLowerCase());
}

export function isRedundantMetadataProfileInvalidUrlIssue(
  issue: ValidationIssue,
  invalidProfileCanonicalValues: Set<string>,
): boolean {
  if (issue.code !== 'metadata-profile-invalid-url' || invalidProfileCanonicalValues.size === 0) return false;
  const value = getDetailsRecord(issue)?.value;
  return typeof value === 'string'
    && invalidProfileCanonicalValues.has(value.trim().toLowerCase());
}

export function getQuestionnaireReferenceWarningKey(issue: ValidationIssue): string | null {
  if (issue.code !== 'questionnaire-reference-not-resolved') return null;
  if (normalizeRequiredElementPath(issue) !== 'questionnaire') return null;
  const questionnaire = getDetailsRecord(issue)?.questionnaire;
  return typeof questionnaire === 'string' && questionnaire.trim().length > 0
    ? questionnaire.trim().toLowerCase()
    : null;
}

export function normalizeNarrativeMissingDivPath(issue: ValidationIssue): string {
  const path = normalizeRequiredElementPath(issue);
  return path.endsWith('.div') ? path : `${path}.div`;
}

export function normalizeNarrativeTextPath(issue: ValidationIssue): string {
  const path = normalizeRequiredElementPath(issue);
  return path.endsWith('.div') ? path.slice(0, -'.div'.length) : path;
}
