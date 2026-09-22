/**
 * Host embedding surface for @records-fhir/validator.
 *
 * This subpath is the stable contract for applications that embed the
 * standalone validator and need to wire host services such as logging,
 * profile resolution, custom rules, package installation, or validation
 * warmup lifecycle hooks.
 *
 * Runtime validators should keep using the package root. Host applications
 * should prefer this file over importing internal `core/*` modules directly.
 */

export { setEngineLogger } from '../logger.js';
export { createValidationDependencySnapshot } from '../validation-dependency-snapshot.js';
export type { EngineLogger } from '../logger.js';

export {
  getCustomRulesSource,
  getProfileSource,
  setCustomRulesSource,
  setProfileSource,
} from '../persistence/index.js';
export type {
  CustomRulesSource,
  EngineCustomRule,
  ProfileResolutionEntry,
  ProfileSourceContext,
  ProfileSource,
} from '../persistence/index.js';
export { createFilesystemProfileSource } from '../persistence/filesystem-profile-source.js';
export type { FilesystemProfileSourceOptions } from '../persistence/filesystem-profile-source.js';

export { resetWarmupState } from '../core/profile-cache-warmup.js';
export { ProfileWarmupCoordinator } from '../core/profile-warmup-coordinator.js';
export type { ProfileWarmupResult } from '../core/profile-warmup-coordinator.js';
export {
  dedupeIssues,
  dedupeIssuesWithTrace,
  suppressRedundantBindingWarnings,
} from '../core/validation-utils.js';
export type {
  DedupeIssuesResult,
  DedupeSuppressionTrace,
} from '../core/validation-utils.js';
export {
  addR6WarningIfNeeded,
  createR6Warning,
  getR6SupportSummary,
  isR6,
  shouldAddR6Warning,
} from '../utils/r6-support-warnings.js';
export type {
  R6ValidationAspect,
  R6WarningType,
} from '../utils/r6-support-warnings.js';
export { detailedResultToOperationOutcome } from '../core/operation-outcome-converter.js';
export { isPrimitiveType } from '../core/executors/structural-executor-helpers.js';
export { CustomRuleExecutor } from '../core/executors/custom-rule-executor.js';
export { RuleRegistry } from '../business-rules/rule-registry.js';
export { getCombinedFHIRPathCacheStats } from '../validator-singleton.js';
export {
  normalizeKnownStructureDefinitionCanonicalUrl,
  StructureDefinitionLoader,
} from '../core/structure-definition-loader.js';
export { isKnownSecurityLabelCode } from '../metadata/security-validators.js';
export { scanCacheDirectory } from '../core/sd-loader-package-scanner.js';
export type { ScanCacheDirectoryOptions } from '../core/sd-loader-package-scanner.js';
export { loadFromPersistentIndex } from '../core/sd-loader-persistent-index.js';
export type { PersistentIndexOptions } from '../core/sd-loader-persistent-index.js';
export {
  isPackageAllowed,
  parseAllowedPackages,
} from '../core/sd-loader-package-config.js';
export type {
  Binding,
  Constraint,
  ElementDefinition,
  ElementType,
  StructureDefinition,
} from '../core/structure-definition-loader.js';
export {
  PackageDownloader,
} from '../package/package-downloader.js';
export {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_TOTAL_BYTES,
  isSafePackageArchiveEntry,
  isIgnorablePackageArchiveMetadata,
  isSafePackageId,
  isSafePackageVersion,
  packageErrorMetadata,
  packageReferenceMetadata,
  packageTargetMetadata,
} from '../package/package-artifact-policy.js';
export type {
  DownloadResult,
  PackageDownloadOptions,
} from '../package/package-downloader.js';
export { compareVersions } from '../package-resolver/version-comparator.js';

export {
  createBindingUnverified,
  createBindingViolation,
  createValueSetUnavailable,
  createConstraintViolation,
  createReferenceTypeMismatch,
  createRequiredElementMissing,
  createValidationError,
  createValidationIssue,
  resetIssueCounter,
  type CreateIssueParams,
} from '../issues/index.js';
export {
  BusinessRuleCodes,
  getCodeMetadata,
  isKnownCode,
  loadCodeAliases,
  MetadataCodes,
  ProfileCodes,
  ReferenceCodes,
  resolveCode,
  StructuralCodes,
  TerminologyCodes,
  ValidationCodes,
} from '../issues/codes/index.js';
export type {
  BusinessRuleCode,
  MetadataCode,
  ProfileCode,
  ReferenceCode,
  StructuralCode,
  TerminologyCode,
  ValidationCode,
  ValidationCodeMetadata,
} from '../issues/codes/index.js';
export { CodeAliases } from '../issues/codes/code-aliases.js';
export {
  formatMessage,
  getHumanReadableMessage,
  HumanReadableTemplates,
} from '../issues/message-formatting.js';
export { MessageTemplates } from '../issues/message-templates.js';
export { mapToHl7IssueType } from '../core/operation-outcome-converter.js';
