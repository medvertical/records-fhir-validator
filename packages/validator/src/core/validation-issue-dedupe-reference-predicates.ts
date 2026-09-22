import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeIssuePathForDedupe } from './validation-issue-dedupe-constraints.js';
import {
  getBundleReferenceIssueKey,
  getIssueReferenceValue,
  getQuestionnaireReferenceWarningKey,
  getScopedMustSupportPath,
  isSliceSpecificMustSupportIssue,
  normalizeBundleRequestPath,
  normalizeQuestionnairePathWithIndices,
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-utils.js';

export function isRedundantReferenceFormatIssue(
  issue: ValidationIssue,
  ref1InvariantPaths: Set<string>,
): boolean {
  if (ref1InvariantPaths.size === 0) return false;
  if (issue.code !== 'reference-invalid-format') return false;
  return ref1InvariantPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantQuestionnaireReferenceWarning(
  issue: ValidationIssue,
  invalidQuestionnaireCanonicalReferences: Set<string>,
): boolean {
  if (invalidQuestionnaireCanonicalReferences.size === 0) return false;
  const key = getQuestionnaireReferenceWarningKey(issue);
  return Boolean(key && invalidQuestionnaireCanonicalReferences.has(key));
}

export function isSpecificRequiredElementMissingIssue(issue: ValidationIssue): boolean {
  return issue.code === 'questionnaire-missing-status' || issue.code === 'qr-missing-status';
}

export function isRedundantGenericMustSupportIssue(issue: ValidationIssue, sliceSpecificMustSupportPaths: Set<string>): boolean {
  if (sliceSpecificMustSupportPaths.size === 0) return false;
  if (issue.code !== 'profile-mustsupport-missing') return false;
  if (isSliceSpecificMustSupportIssue(issue)) return false;
  return sliceSpecificMustSupportPaths.has(getScopedMustSupportPath(issue));
}

export function isRedundantCardinalityMinIssue(issue: ValidationIssue, specificRequiredElementPaths: Set<string>): boolean {
  if (specificRequiredElementPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  return specificRequiredElementPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantQuestionnaireAnswerOptionValueCardinalityIssue(
  issue: ValidationIssue,
  disallowedAnswerOptionPaths: Set<string>,
): boolean {
  if (disallowedAnswerOptionPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  const path = normalizeQuestionnairePathWithIndices(issue);
  const match = path.match(/^(.*)\.answeroption\[\d+\]\.value\[x\]$/);
  return Boolean(match?.[1] && disallowedAnswerOptionPaths.has(match[1]));
}

export function isRedundantProfileMissingSystemIssue(issue: ValidationIssue, terminologyMissingSystemPaths: Set<string>): boolean {
  if (terminologyMissingSystemPaths.size === 0) return false;
  if (issue.aspect !== 'profile' || issue.code !== 'terminology-coding-missing-system') return false;
  return terminologyMissingSystemPaths.has(normalizeIssuePathForDedupe(issue));
}

export function isRedundantMetadataTagCodeWithoutSystemIssue(issue: ValidationIssue, terminologyMissingSystemPaths: Set<string>): boolean {
  if (terminologyMissingSystemPaths.size === 0) return false;
  if (issue.code !== 'metadata-tag-code-without-system') return false;
  return terminologyMissingSystemPaths.has(normalizeIssuePathForDedupe(issue));
}

export function isRedundantReferenceTypeMismatchIssue(issue: ValidationIssue, structuralReferenceTargetValues: Set<string>): boolean {
  if (structuralReferenceTargetValues.size === 0) return false;
  if (issue.code !== 'reference-type-mismatch') return false;
  const reference = getIssueReferenceValue(issue);
  return Boolean(reference && structuralReferenceTargetValues.has(reference));
}

export function isRedundantBundleRequestRequiredElementIssue(issue: ValidationIssue, bundleRequestMissingUrlPaths: Set<string>): boolean {
  if (bundleRequestMissingUrlPaths.size === 0) return false;
  if (issue.code !== 'structural-required-element-missing') return false;
  return bundleRequestMissingUrlPaths.has(normalizeBundleRequestPath(issue));
}

export function isRedundantBundleReferenceIssue(issue: ValidationIssue, bundleCrossEntryReferenceKeys: Set<string>): boolean {
  if (bundleCrossEntryReferenceKeys.size === 0) return false;
  if (issue.code !== 'reference-bundle-unresolved') return false;
  const key = getBundleReferenceIssueKey(issue);
  return Boolean(key && bundleCrossEntryReferenceKeys.has(key));
}

export function isRedundantGenericInvalidReferenceIssue(issue: ValidationIssue, structuralInvalidReferenceValues: Set<string>): boolean {
  if (structuralInvalidReferenceValues.size === 0) return false;
  if (issue.code !== 'invalid-reference-format') return false;
  const reference = getIssueReferenceValue(issue);
  return Boolean(reference && structuralInvalidReferenceValues.has(reference));
}

export function isRedundantUnresolvedInvalidReferenceIssue(issue: ValidationIssue, structuralInvalidReferenceValues: Set<string>): boolean {
  if (structuralInvalidReferenceValues.size === 0) return false;
  if (issue.code !== 'reference-bundle-unresolved' && issue.code !== 'bundle-cross-entry-reference-missing') {
    return false;
  }
  const reference = getIssueReferenceValue(issue);
  return Boolean(reference && structuralInvalidReferenceValues.has(reference));
}
