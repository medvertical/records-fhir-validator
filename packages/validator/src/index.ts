/**
 * Records Validator - Main Export
 *
 * Pure JavaScript/TypeScript FHIR Validation Engine.
 *
 * Usage:
 *   import { recordsValidator } from '@records-fhir/validator';
 *   const issues = await recordsValidator.validateRequest({ resource, profileUrl });
 */

export {
  acquireRecordsValidatorRuntime,
  ensureRecordsValidatorReady,
  getRecordsValidatorClass,
  recordsValidator,
} from './validator-singleton.js';
export type {
  RecordsValidationRequest,
  RecordsValidatorAdministration,
  RecordsValidatorInspection,
  RecordsValidatorRuntimeLease,
  RecordsValidatorSingleton,
  RecordsValidatorValidation,
} from './validator-singleton-types.js';

/**
 * The two `@records-fhir/validation-types` types the public surface names in
 * its own signatures. `PublicValidationResult.issues` is `ValidationIssue[]`
 * and `validate()` takes `ValidationSettings`, so a consumer could not write
 * the types of values this package hands them without adding a second direct
 * dependency. Re-exported here, not through a `./types` subpath: a subpath
 * would publish a second public name for types that are already public from
 * the other package.
 */
export type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';

export { resolveFhirReleaseContext, toInternalFhirVersion } from './public-validation-api.js';
export type {
  FhirReleaseContext,
  PublicBatchValidationOptions,
  PublicFhirVersion,
  PublicValidationInput,
  PublicValidationRequest,
  PublicValidationResult,
} from './public-validation-api.js';

// Validator classes kept on the root surface for backward compatibility.
export { BestPracticeValidator, validateBestPractices } from './validators/best-practice-validator.js';
export type { BestPracticeSettings, BestPracticeValidationContext } from './validators/best-practice-validator.js';
export { ExtensionValidator } from './validators/extension-validator.js';
export { SlicingValidator } from './validators/slicing-validator.js';
export { ValueSetValidator } from './validators/valueset-validator.js';
export { ConstraintValidator } from './validators/constraint-validator.js';
export type { FHIRPathConstraintDiagnostics } from './validators/constraint-validator.js';
export { SnapshotGenerator } from './core/snapshot-generator.js';
export { inferCodeBasedProfiles, matchCodeInferredProfile } from './core/code-inferred-profiles.js';
export { shouldRunCustomRules } from './core/validation-settings-predicates.js';
export type { CodeInferredProfileMatch } from './core/code-inferred-profiles.js';
export {
  CODE_INFERRED_SIGNPOST_CODE,
  createCodeInferredProfileSignpostIssue,
} from './core/code-inferred-profile-attribution.js';

export type { RecordsValidatorConfig, ValidationContext } from './core/validator-engine.js';
export type { StructureDefinition, ElementDefinition } from './core/structure-definition-types.js';

export { setEngineLogger } from './logger.js';
export type { EngineLogger } from './logger.js';
export {
  setTerminologyBrokerObserver,
  TerminologyRequestBroker,
} from './validators/terminology-request-broker.js';
export type {
  TerminologyBrokerObservation,
  TerminologyBrokerObserver,
  TerminologyRemoteOperation,
} from './validators/terminology-request-broker.js';
export {
  getCustomRulesSource,
  getProfileSource,
  setCustomRulesSource,
  setProfileSource,
} from './persistence/index.js';
export type {
  CustomRulesSource,
  EngineCustomRule,
  ProfileResolutionEntry,
  ProfileSourceContext,
  ProfileSource,
} from './persistence/index.js';
export { createFilesystemProfileSource } from './persistence/filesystem-profile-source.js';
export type { FilesystemProfileSourceOptions } from './persistence/filesystem-profile-source.js';

// Issue helpers used by the public CLI/action and fix-suggestion integrations.
export {
  applyFixPatch,
  createValidationIssue,
  FixSuggestions,
  formatFixSuggestion,
  getFixSuggestion,
  issueFingerprint,
  issueMatchesAnchor,
  issuePathMatchesPattern,
  stableIssues,
  summarizeIssueAnchors,
  summarizeIssueFingerprints,
  type CreateIssueParams,
  type ExpectedIssueAnchor,
  type FixApplyResult,
  type FixSuggestion,
  type StableIssueSummaryOptions,
} from './issues/index.js';

export {
  checkFhirpathSandbox,
  type SandboxLimits,
  type SandboxResult,
} from './validators/fhirpath-sandbox.js';

export {
  dedupeIssues,
  dedupeIssuesWithTrace,
  suppressSemanticIssuesWithTrace,
  type DedupeIssuesResult,
  type DedupeSuppressionTrace,
} from './dedupe.js';

export {
  parseFhirNdjson,
  parseFhirXml,
  type FhirInputDiagnostic,
  type FhirInputLimits,
  type FhirInputLocation,
  type ParsedFhirInput,
} from './input/index.js';
