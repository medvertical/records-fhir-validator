import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  getConstraintDedupeKeys,
  isBundleDuplicateFullUrlIssue,
  normalizeIssuePathForDedupe,
} from './validation-issue-dedupe-constraints.js';
import {
  getExtensionMaxCardinalityKey,
  getRequiredBindingViolationKey,
  getStructuralDom3ContainedIssueKey,
  isContainedUnreferencedInvalidIssue,
  isSpecificRequiredElementMissingIssue,
  isTerminologySystemInvalidIssue,
} from './validation-issue-dedupe-rule-predicates.js';
import {
  compareDisplayMismatchSpecificity,
  compareInvalidUriSpecificity,
  compareTerminologyCodeInvalidSpecificity,
  getBundleReferenceIssueKey,
  getInvalidProfileCanonicalValue,
  getInvalidQuestionnaireCanonicalReferenceKey,
  getInvalidUriIssueKey,
  getIssueReferenceValue,
  getQuestionnaireAnswerOptionDisallowedPath,
  getScopedMustSupportPath,
  getTerminologyCodeInvalidKey,
  getTerminologyDisplayMismatchKey,
  isSliceSpecificMustSupportIssue,
  normalizeBundleRequestPath,
  normalizeNarrativeMissingDivPath,
  normalizeNarrativeTextPath,
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-utils.js';
import {
  getEffectiveRuleId,
  getSpecificConstraintKey,
  isGermanGenderExtensionMissingIssue,
  isInvariantSpecificConstraintIssue,
  isSpecificNameInvariantIssue,
  isStructuralDateTimeMissingTimezoneIssue,
} from './validation-issue-dedupe-profile-signals.js';

export interface DedupeContext {
  specificBundleInvariantKeys: Set<string>;
  bundleInvariantPresencePaths: Set<string>;
  specificConstraintKeys: Set<string>;
  invariantSpecificConstraintKeys: Set<string>;
  cardinalityMinPaths: Set<string>;
  patternMismatchPaths: Set<string>;
  profileExtensionMinPaths: Set<string>;
  profileSliceMinPaths: Set<string>;
  profileExtensionMaxKeys: Set<string>;
  mustSupportPaths: Set<string>;
  ref1InvariantPaths: Set<string>;
  invalidUriPaths: Set<string>;
  invalidTerminologySystemPaths: Set<string>;
  invalidQuestionnaireCanonicalReferences: Set<string>;
  invalidProfileCanonicalValues: Set<string>;
  containedInvalidPaths: Set<string>;
  requiredBindingViolationPaths: Set<string>;
  terminologyRequiredBindingKeys: Set<string>;
  extensionNoValuePaths: Set<string>;
  narrativeMissingDivPaths: Set<string>;
  narrativeMissingDivTextPaths: Set<string>;
  structuralDom3ContainedKeys: Set<string>;
  structuralInvalidReferenceValues: Set<string>;
  structuralReferenceTargetValues: Set<string>;
  bundleRequestMissingUrlPaths: Set<string>;
  bundleCrossEntryReferenceKeys: Set<string>;
  terminologyMissingSystemPaths: Set<string>;
  specificRequiredElementPaths: Set<string>;
  structuralDateTimeMissingTimezonePaths: Set<string>;
  specificCanonicalInvalidPaths: Set<string>;
  specificNameInvariantRulesByPath: Map<string, Set<string>>;
  questionnaireQue1Paths: Set<string>;
  questionnaireAnswerOptionDisallowedPaths: Set<string>;
  sliceSpecificMustSupportPaths: Set<string>;
  preferredInvalidUriIssues: Map<string, ValidationIssue>;
  preferredDisplayMismatchIssues: Map<string, ValidationIssue>;
  preferredTerminologyCodeInvalidIssues: Map<string, ValidationIssue>;
  hasGermanGenderExtensionMissing: boolean;
}

export function collectDedupeContext(issues: ValidationIssue[]): DedupeContext {
  const context = createDedupeContext(issues);
  for (const issue of issues) {
    indexPreferredIssues(context, issue);
    indexConstraintsAndCardinality(context, issue);
    indexCanonicalAndContentIssues(context, issue);
    indexReferenceAndProfileIssues(context, issue);
  }
  return context;
}

function createDedupeContext(issues: ValidationIssue[]): DedupeContext {
  return {
    specificBundleInvariantKeys: new Set(),
    bundleInvariantPresencePaths: new Set(),
    specificConstraintKeys: new Set(),
    invariantSpecificConstraintKeys: new Set(),
    cardinalityMinPaths: new Set(),
    patternMismatchPaths: new Set(),
    profileExtensionMinPaths: new Set(),
    profileSliceMinPaths: new Set(),
    profileExtensionMaxKeys: new Set(),
    mustSupportPaths: new Set(),
    ref1InvariantPaths: new Set(),
    invalidUriPaths: new Set(),
    invalidTerminologySystemPaths: new Set(),
    invalidQuestionnaireCanonicalReferences: new Set(),
    invalidProfileCanonicalValues: new Set(),
    containedInvalidPaths: new Set(),
    requiredBindingViolationPaths: new Set(),
    terminologyRequiredBindingKeys: new Set(),
    extensionNoValuePaths: new Set(),
    narrativeMissingDivPaths: new Set(),
    narrativeMissingDivTextPaths: new Set(),
    structuralDom3ContainedKeys: new Set(),
    structuralInvalidReferenceValues: new Set(),
    structuralReferenceTargetValues: new Set(),
    bundleRequestMissingUrlPaths: new Set(),
    bundleCrossEntryReferenceKeys: new Set(),
    terminologyMissingSystemPaths: new Set(),
    specificRequiredElementPaths: new Set(),
    structuralDateTimeMissingTimezonePaths: new Set(),
    specificCanonicalInvalidPaths: new Set(),
    specificNameInvariantRulesByPath: new Map(),
    questionnaireQue1Paths: new Set(),
    questionnaireAnswerOptionDisallowedPaths: new Set(),
    sliceSpecificMustSupportPaths: new Set(),
    preferredInvalidUriIssues: new Map(),
    preferredDisplayMismatchIssues: new Map(),
    preferredTerminologyCodeInvalidIssues: new Map(),
    hasGermanGenderExtensionMissing: issues.some(isGermanGenderExtensionMissingIssue),
  };
}

function indexPreferredIssues(context: DedupeContext, issue: ValidationIssue): void {
  updatePreferredIssue(
    context.preferredTerminologyCodeInvalidIssues,
    getTerminologyCodeInvalidKey(issue),
    issue,
    compareTerminologyCodeInvalidSpecificity,
  );
  updatePreferredIssue(
    context.preferredDisplayMismatchIssues,
    getTerminologyDisplayMismatchKey(issue),
    issue,
    compareDisplayMismatchSpecificity,
  );
  updatePreferredIssue(
    context.preferredInvalidUriIssues,
    getInvalidUriIssueKey(issue),
    issue,
    compareInvalidUriSpecificity,
  );
}

function updatePreferredIssue(
  preferredIssues: Map<string, ValidationIssue>,
  key: string | null,
  issue: ValidationIssue,
  compareSpecificity: (left: ValidationIssue, right: ValidationIssue) => number,
): void {
  if (!key) return;
  const existing = preferredIssues.get(key);
  if (!existing || compareSpecificity(issue, existing) > 0) {
    preferredIssues.set(key, issue);
  }
}

function indexConstraintsAndCardinality(context: DedupeContext, issue: ValidationIssue): void {
  if (issue.code === 'bdl-9-violation' || issue.code === 'bdl-10-violation') {
    context.specificBundleInvariantKeys.add(issue.code === 'bdl-9-violation' ? 'bdl-9' : 'bdl-10');
    context.bundleInvariantPresencePaths.add(normalizeRequiredElementPath(issue));
  }
  if (isBundleDuplicateFullUrlIssue(issue)) {
    context.specificBundleInvariantKeys.add('bdl-7');
  }

  const constraintKey = getSpecificConstraintKey(issue);
  if (constraintKey) {
    for (const key of getConstraintDedupeKeys(issue, constraintKey)) {
      context.specificConstraintKeys.add(key);
      if (isInvariantSpecificConstraintIssue(issue)) {
        context.invariantSpecificConstraintKeys.add(key);
      }
    }
  }

  const requiredPath = normalizeRequiredElementPath(issue);
  if (issue.code === 'structural-cardinality-min') context.cardinalityMinPaths.add(requiredPath);
  if (issue.code === 'profile-pattern-mismatch') {
    context.patternMismatchPaths.add(normalizeIssuePathForDedupe(issue));
  }
  if (issue.code === 'profile-extension-min-cardinality') context.profileExtensionMinPaths.add(requiredPath);
  if (issue.code === 'profile-slice-min-cardinality') context.profileSliceMinPaths.add(requiredPath);
  if (issue.code === 'profile-mustsupport-missing') context.mustSupportPaths.add(requiredPath);
  if (issue.code === 'ref-1-violation') context.ref1InvariantPaths.add(requiredPath);

  const extensionMaxKey = getExtensionMaxCardinalityKey(issue);
  if (issue.code === 'profile-extension-max-cardinality' && extensionMaxKey) {
    context.profileExtensionMaxKeys.add(extensionMaxKey);
  }
}

function indexCanonicalAndContentIssues(context: DedupeContext, issue: ValidationIssue): void {
  const requiredPath = normalizeRequiredElementPath(issue);
  if (issue.code === 'structural-invalid-uri') {
    context.invalidUriPaths.add(requiredPath);
    const profileCanonical = getInvalidProfileCanonicalValue(issue);
    if (profileCanonical) context.invalidProfileCanonicalValues.add(profileCanonical);
    const questionnaireKey = getInvalidQuestionnaireCanonicalReferenceKey(issue);
    if (questionnaireKey) context.invalidQuestionnaireCanonicalReferences.add(questionnaireKey);
  }
  if (issue.code === 'tx-codesystem-url-not-absolute') {
    context.specificCanonicalInvalidPaths.add(requiredPath);
  }
  if (isTerminologySystemInvalidIssue(issue)) {
    context.invalidTerminologySystemPaths.add(requiredPath);
  }
  if (isContainedUnreferencedInvalidIssue(issue)) {
    context.containedInvalidPaths.add(requiredPath);
  }
  if (issue.code === 'profile-required-binding-violation') {
    context.requiredBindingViolationPaths.add(requiredPath);
  }
  if (
    issue.code === 'terminology-binding-required' ||
    issue.code === 'terminology-binding-required-code'
  ) {
    const key = getRequiredBindingViolationKey(issue);
    if (key) context.terminologyRequiredBindingKeys.add(key);
  }
  if (issue.code === 'profile-extension-no-value') {
    context.extensionNoValuePaths.add(requiredPath);
  }
  if (issue.code === 'narrative-missing-div') {
    context.narrativeMissingDivPaths.add(normalizeNarrativeMissingDivPath(issue));
    context.narrativeMissingDivTextPaths.add(normalizeNarrativeTextPath(issue));
  }
  const dom3Key = getStructuralDom3ContainedIssueKey(issue);
  if (dom3Key) context.structuralDom3ContainedKeys.add(dom3Key);
}

function indexReferenceAndProfileIssues(context: DedupeContext, issue: ValidationIssue): void {
  if (issue.code === 'reference-invalid-format') {
    const reference = getIssueReferenceValue(issue);
    if (reference) context.structuralInvalidReferenceValues.add(reference);
  }
  if (issue.code === 'reference-target-type-invalid') {
    const reference = getIssueReferenceValue(issue);
    if (reference) context.structuralReferenceTargetValues.add(reference);
  }
  if (issue.code === 'reference-bundle-request-missing-url') {
    context.bundleRequestMissingUrlPaths.add(normalizeBundleRequestPath(issue));
  }
  if (issue.code === 'bundle-cross-entry-reference-missing') {
    const key = getBundleReferenceIssueKey(issue);
    if (key) context.bundleCrossEntryReferenceKeys.add(key);
  }
  if (issue.aspect === 'terminology' && issue.code === 'terminology-coding-missing-system') {
    context.terminologyMissingSystemPaths.add(normalizeIssuePathForDedupe(issue));
  }
  if (isSpecificRequiredElementMissingIssue(issue)) {
    const path = normalizeRequiredElementPath(issue);
    context.specificRequiredElementPaths.add(path);
    context.cardinalityMinPaths.add(path);
  }
  if (isStructuralDateTimeMissingTimezoneIssue(issue)) {
    context.structuralDateTimeMissingTimezonePaths.add(normalizeIssuePathForDedupe(issue));
  }
  if (isSpecificNameInvariantIssue(issue)) {
    const path = normalizeRequiredElementPath(issue);
    const rules = context.specificNameInvariantRulesByPath.get(path) ?? new Set<string>();
    rules.add(getEffectiveRuleId(issue) ?? '');
    context.specificNameInvariantRulesByPath.set(path, rules);
  }
  if (issue.code === 'questionnaire-invariant-que-1') {
    context.questionnaireQue1Paths.add(normalizeRequiredElementPath(issue));
  }
  const answerOptionPath = getQuestionnaireAnswerOptionDisallowedPath(issue);
  if (answerOptionPath) context.questionnaireAnswerOptionDisallowedPaths.add(answerOptionPath);
  if (isSliceSpecificMustSupportIssue(issue)) {
    context.sliceSpecificMustSupportPaths.add(getScopedMustSupportPath(issue));
  }
}
