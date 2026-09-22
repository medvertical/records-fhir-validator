/** Stable internal surface for dedupe key, path, terminology, and reference helpers. */
export { getDetailsRecord, getIssuePath } from './validation-issue-dedupe-common.js';
export {
  getInvalidProfileCanonicalValue,
  getInvalidQuestionnaireCanonicalReferenceKey,
  getQuestionnaireAnswerOptionDisallowedPath,
  getQuestionnaireReferenceWarningKey,
  getScopedMustSupportPath,
  isRedundantMetadataProfileInvalidUrlIssue,
  isRedundantProfileNotResolvedWarning,
  isSliceSpecificMustSupportIssue,
  normalizeNarrativeMissingDivPath,
  normalizeNarrativeTextPath,
  normalizeQuestionnairePathWithIndices,
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-path-utils.js';
export {
  getBundleReferenceIssueKey,
  getIssueReferenceValue,
  normalizeBundleRequestPath,
} from './validation-issue-dedupe-reference-utils.js';
export {
  compareDisplayMismatchSpecificity,
  compareInvalidUriSpecificity,
  compareTerminologyCodeInvalidSpecificity,
  getInvalidUriIssueKey,
  getTerminologyCodeInvalidKey,
  getTerminologyDisplayMismatchKey,
} from './validation-issue-dedupe-terminology-utils.js';
