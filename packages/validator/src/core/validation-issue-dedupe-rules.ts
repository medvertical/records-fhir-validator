import type { ValidationIssue } from '@records-fhir/validation-types';
import type { DedupeContext } from './validation-issue-dedupe-context.js';
import {
  isRedundantBestPracticePresenceIssue,
  isRedundantBundleReferenceIssue,
  isRedundantBundleRequestRequiredElementIssue,
  isRedundantCardinalityMinIssue,
  isRedundantContainedUnreferencedIssue,
  isRedundantDom6Issue,
  isRedundantExtensionConstraintIssue,
  isRedundantExtensionSliceMaxIssue,
  isRedundantGenericInvalidReferenceIssue,
  isRedundantGenericMustSupportIssue,
  isRedundantInvalidUriIssue,
  isRedundantMetadataTagCodeWithoutSystemIssue,
  isRedundantMustSupportBestPracticeIssue,
  isRedundantNarrativeRequiredElementIssue,
  isRedundantPresenceInvariantIssue,
  isRedundantProfileDom3Issue,
  isRedundantProfileExtensionCardinalityIssue,
  isRedundantProfileMissingSystemIssue,
  isRedundantProfileRequiredBindingIssue,
  isRedundantProfileSliceCardinalityIssue,
  isRedundantQuestionnaireAnswerOptionValueCardinalityIssue,
  isRedundantQuestionnaireReferenceWarning,
  isRedundantReferenceFormatIssue,
  isRedundantReferenceTypeMismatchIssue,
  isRedundantRequiredBindingIssue,
  isRedundantTerminologyCodeInvalidIssue,
  isRedundantTerminologyDisplayMismatchIssue,
  isRedundantTerminologyNotFoundIssue,
  isRedundantUnresolvedInvalidReferenceIssue,
} from './validation-issue-dedupe-rule-predicates.js';
import {
  isRedundantMetadataProfileInvalidUrlIssue,
  isRedundantProfileNotResolvedWarning,
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-utils.js';
import {
  isMiiGenderConstraintIssue,
  isRedundantBundleInvariantIssue,
  isRedundantBundleInvariantPresenceIssue,
  isRedundantGenericConstraintIssue,
  isRedundantMetadataMissingTimezoneIssue,
  isRedundantNameInvariantIssue,
  isRedundantParentPatternMismatchIssue,
  isRedundantProfileSpecificConstraintIssue,
  isRedundantQuestionnaireQue1bIssue,
  isRedundantRequiredElementIssue,
} from './validation-issue-dedupe-profile-suppressions.js';

export interface DedupeSuppressionRule {
  readonly id: string;
  suppress(issue: ValidationIssue): boolean;
}

export function createDedupeSuppressionRules(context: DedupeContext): DedupeSuppressionRule[] {
  return [
    ...createConstraintRules(context),
    ...createCanonicalAndContentRules(context),
    ...createReferenceAndPreferenceRules(context),
  ];
}

export function getSuppressionRuleId(
  issue: ValidationIssue,
  rules: DedupeSuppressionRule[],
): string | null {
  for (const rule of rules) {
    if (rule.suppress(issue)) return rule.id;
  }
  return null;
}

function createConstraintRules(context: DedupeContext): DedupeSuppressionRule[] {
  return [
    rule('bundle-invariant-specific', issue =>
      isRedundantBundleInvariantIssue(issue, context.specificBundleInvariantKeys)),
    rule('bundle-invariant-presence', issue =>
      isRedundantBundleInvariantPresenceIssue(issue, context.bundleInvariantPresencePaths)),
    rule('constraint-specific-over-generic', issue =>
      isRedundantGenericConstraintIssue(issue, context.specificConstraintKeys)),
    rule('profile-specific-over-invariant-specific', issue =>
      isRedundantProfileSpecificConstraintIssue(issue, context.invariantSpecificConstraintKeys)),
    rule('specific-required-over-cardinality-min', issue =>
      isRedundantCardinalityMinIssue(issue, context.specificRequiredElementPaths)),
    rule('german-gender-extension-over-mii-gender', issue =>
      context.hasGermanGenderExtensionMissing && isMiiGenderConstraintIssue(issue)),
    rule('cardinality-min-over-required', issue =>
      isRedundantRequiredElementIssue(issue, context.cardinalityMinPaths)),
    rule('profile-extension-min-over-required', issue =>
      isRedundantRequiredElementIssue(issue, context.profileExtensionMinPaths)),
    rule('profile-slice-min-over-required', issue =>
      isRedundantRequiredElementIssue(issue, context.profileSliceMinPaths)),
    rule('cardinality-min-over-best-practice-presence', issue =>
      isRedundantBestPracticePresenceIssue(issue, context.cardinalityMinPaths)),
    rule('cardinality-min-over-required-binding', issue =>
      isRedundantRequiredBindingIssue(issue, context.cardinalityMinPaths)),
    rule('profile-extension-min-over-structural-cardinality', issue =>
      isRedundantProfileExtensionCardinalityIssue(issue, context.profileExtensionMinPaths)),
    rule('profile-slice-min-over-structural-cardinality', issue =>
      isRedundantProfileSliceCardinalityIssue(issue, context.profileSliceMinPaths)),
    rule('extension-max-over-slice-max', issue =>
      isRedundantExtensionSliceMaxIssue(issue, context.profileExtensionMaxKeys)),
    rule('mustsupport-over-best-practice-presence', issue =>
      isRedundantMustSupportBestPracticeIssue(issue, context.mustSupportPaths)),
    rule('specific-pattern-mismatch-over-parent', issue =>
      isRedundantParentPatternMismatchIssue(issue, context.patternMismatchPaths)),
  ];
}

function createCanonicalAndContentRules(context: DedupeContext): DedupeSuppressionRule[] {
  return [
    rule('ref1-over-reference-format', issue =>
      isRedundantReferenceFormatIssue(issue, context.ref1InvariantPaths)),
    rule('invalid-system-over-terminology-not-found', issue =>
      isRedundantTerminologyNotFoundIssue(
        issue,
        context.invalidUriPaths,
        context.invalidTerminologySystemPaths,
      )),
    rule('specific-canonical-over-structural-uri', issue =>
      issue.code === 'structural-invalid-uri' &&
      context.specificCanonicalInvalidPaths.has(normalizeRequiredElementPath(issue))),
    rule('invalid-questionnaire-canonical-over-reference-warning', issue =>
      isRedundantQuestionnaireReferenceWarning(
        issue,
        context.invalidQuestionnaireCanonicalReferences,
      )),
    rule('invalid-profile-canonical-over-profile-unresolved', issue =>
      isRedundantProfileNotResolvedWarning(issue, context.invalidProfileCanonicalValues)),
    rule('invalid-profile-canonical-over-metadata-profile-url', issue =>
      isRedundantMetadataProfileInvalidUrlIssue(issue, context.invalidProfileCanonicalValues)),
    rule('contained-invalid-over-unreferenced', issue =>
      isRedundantContainedUnreferencedIssue(issue, context.containedInvalidPaths)),
    rule('required-binding-over-presence-invariant', issue =>
      isRedundantPresenceInvariantIssue(issue, context.requiredBindingViolationPaths)),
    rule('specific-terminology-binding-over-profile-binding', issue =>
      isRedundantProfileRequiredBindingIssue(issue, context.terminologyRequiredBindingKeys)),
    rule('extension-no-value-over-ext1', issue =>
      isRedundantExtensionConstraintIssue(issue, context.extensionNoValuePaths)),
    rule('narrative-div-over-required', issue =>
      isRedundantNarrativeRequiredElementIssue(issue, context.narrativeMissingDivPaths)),
    rule('narrative-text-over-dom6', issue =>
      isRedundantDom6Issue(issue, context.narrativeMissingDivTextPaths)),
    rule('contained-invalid-over-profile-dom3', issue =>
      isRedundantProfileDom3Issue(issue, context.structuralDom3ContainedKeys)),
  ];
}

function createReferenceAndPreferenceRules(context: DedupeContext): DedupeSuppressionRule[] {
  return [
    rule('structural-invalid-reference-over-generic', issue =>
      isRedundantGenericInvalidReferenceIssue(issue, context.structuralInvalidReferenceValues)),
    rule('structural-invalid-reference-over-unresolved', issue =>
      isRedundantUnresolvedInvalidReferenceIssue(issue, context.structuralInvalidReferenceValues)),
    rule('structural-reference-target-over-type-mismatch', issue =>
      isRedundantReferenceTypeMismatchIssue(issue, context.structuralReferenceTargetValues)),
    rule('bundle-request-url-over-required', issue =>
      isRedundantBundleRequestRequiredElementIssue(issue, context.bundleRequestMissingUrlPaths)),
    rule('bundle-cross-entry-over-unresolved', issue =>
      isRedundantBundleReferenceIssue(issue, context.bundleCrossEntryReferenceKeys)),
    rule('terminology-missing-system-over-profile-copy', issue =>
      isRedundantProfileMissingSystemIssue(issue, context.terminologyMissingSystemPaths)),
    rule('terminology-missing-system-over-metadata-tag', issue =>
      isRedundantMetadataTagCodeWithoutSystemIssue(issue, context.terminologyMissingSystemPaths)),
    rule('specific-invalid-uri-preferred', issue =>
      isRedundantInvalidUriIssue(issue, context.preferredInvalidUriIssues)),
    rule('specific-display-mismatch-preferred', issue =>
      isRedundantTerminologyDisplayMismatchIssue(issue, context.preferredDisplayMismatchIssues)),
    rule('specific-terminology-code-invalid-preferred', issue =>
      isRedundantTerminologyCodeInvalidIssue(
        issue,
        context.preferredTerminologyCodeInvalidIssues,
      )),
    rule('structural-timezone-over-metadata-timezone', issue =>
      isRedundantMetadataMissingTimezoneIssue(
        issue,
        context.structuralDateTimeMissingTimezonePaths,
      )),
    rule('specific-name-invariant-over-generic', issue =>
      isRedundantNameInvariantIssue(issue, context.specificNameInvariantRulesByPath)),
    rule('que1-over-que1b', issue =>
      isRedundantQuestionnaireQue1bIssue(issue, context.questionnaireQue1Paths)),
    rule('answer-option-value-over-cardinality', issue =>
      isRedundantQuestionnaireAnswerOptionValueCardinalityIssue(
        issue,
        context.questionnaireAnswerOptionDisallowedPaths,
      )),
    rule('slice-specific-mustsupport-over-generic', issue =>
      isRedundantGenericMustSupportIssue(issue, context.sliceSpecificMustSupportPaths)),
  ];
}

function rule(
  id: string,
  suppress: (issue: ValidationIssue) => boolean,
): DedupeSuppressionRule {
  return { id, suppress };
}
