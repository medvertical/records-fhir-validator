/**
 * Validation Types - Barrel Export
 * 
 * Centralized exports for all validation-related types.
 * This is the single entry point for validation types to prevent circular dependencies.
 * 
 * Usage:
 *   import { ValidationIssue, ValidationResult, ValidationSettings } from '@records-fhir/validation-types';
 */

// ============================================================================
// Enums and Type Unions
// ============================================================================

export type {
  ValidationAspect,
  ValidationSeverity,
  ValidationStrictness,
  ValidationStatus,
  ValidationAction,
  StructuralValidationEngine,
  ProfileValidationEngine,
  TerminologyValidationEngine,
  ReferenceValidationEngine,
  InvariantValidationEngine,
  CustomRuleValidationEngine,
  MetadataValidationEngine,
  ServerStatus,
  FHIRVersion
} from './enums';

export type {
  ValidationAspectType
} from './aspect-enums';

export {
  DEFAULT_VALIDATION_STRICTNESS,
  VALIDATION_ASPECTS,
  VALIDATION_ASPECT_LABELS,
  VALIDATION_ASPECT_DESCRIPTIONS
} from './enums';

export {
  CANONICAL_CUSTOM_RULE_ASPECT,
  normalizeValidationAspect,
  normalizeValidationAspects,
  normalizeValidationSettings
} from './aspect-aliases';

// ============================================================================
// Messages and Issues
// ============================================================================

export type {
  ValidationIssue,
  ValidationError,
  ValidationRetryInfo,
  ValidationRetryAttempt
} from './messages';

// ============================================================================
// Results and Progress
// ============================================================================

export type {
  ValidationResult,
  EnhancedValidationSummary,
  ValidationProgress,
  ValidationRunSummary,
  ValidationMetrics,
} from './results';

export type {
  ValidationQualityMetrics,
  ValidationAccuracyMetrics,
  ValidationConsistencyMetrics,
  ValidationPerformanceMetrics,
  ValidationReliabilityMetrics,
  ValidationAspectQuality,
  ValidationQualityTrend,
  ValidationAspectQualityTrend,
  ValidationQualityRecommendation,
  ValidationQualityConfig,
  ValidationQualityReport,
  ValidationConfidenceFactors,
  ValidationConfidenceIssue,
  ValidationConfidenceMetrics,
  ValidationResultWithConfidence,
  ValidationConfidenceAction,
  ValidationCompletenessFactors,
  ValidationCoverageMetrics,
  MissingValidationArea,
  ValidationGap,
  ValidationCompletenessMetrics,
  ValidationResultWithCompleteness,
  ValidationCompletenessAction,
} from './validation-advanced-metrics';

// ============================================================================
// Settings and Configuration
// ============================================================================

export type {
  ProfileSourcesConfig,
  ValidationAspectConfig,
  TerminologyServer,
  TerminologyAuthConfig,
  CircuitBreakerConfig,
  ValidationSettings,
  ValidationSettingsUpdate,
  ValidationSettingsValidationResult,
  FHIRResourceTypeConfig,
  AdvancedTerminologyConfig,
  ProfileApplicationSource,
  ImposedProfilePolicy,
  ImposedProfilesConfig,
  AdvisorRule,
  AdvisorRuleMatch,
  AdvisorRuleTransform
} from './settings';

export { PERFORMANCE_LIMITS } from './settings';

export {
  COMMON_FHIR_RESOURCE_TYPES,
  CONFORMANCE_RESOURCE_TYPES,
  R4_ALL_RESOURCE_TYPES,
  R5_ALL_RESOURCE_TYPES,
  R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
  R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
  type CommonFhirResourceType,
} from './settings-types';

export {
  DEFAULT_VALIDATION_SETTINGS_R4,
  DEFAULT_VALIDATION_SETTINGS_R5,
  DEFAULT_ADVANCED_TERMINOLOGY,
  VALIDATION_CONFIGS,
  DEFAULT_TERMINOLOGY_SERVERS,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_CACHE_CONFIG,
  createEhds2026ValidationSettings,
  createMii2026ValidationSettings,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  type FhirPackagePin,
  type Mii2026ValidationSettingsOverrides,
  type MiiTerminologyMode
} from './settings-defaults';

export {
  validatePerformanceSettings,
  validateResourceTypeSettings,
  validateResourceTypeSettingsForVersion,
  validateValidationSettings,
} from './settings-validators';

export {
  DEFAULT_PROFILE_SOURCES_CONFIG,
  normalizeProfileSourcesConfig,
  safeParseSettingsUpdate
} from './settings-schema';

export {
  getAllResourceTypesForVersion,
  getDefaultIncludedTypesForVersion,
  isResourceTypeAvailableInVersion,
  getUnavailableResourceTypes,
  getR5SpecificResourceTypes,
  migrateResourceTypesForVersion,
  getEffectiveResourceTypes,
  shouldValidateResourceType,
} from './settings-transformers';

export {
  getDefaultPerformanceSettings,
  getDefaultResourceTypeSettings,
  getDefaultValidationSettingsForVersion,
  getDefaultValidationSettings,
  createDefaultValidationSettings,
  resetToDefaultSettings,
  isDefaultSettings,
  getEnabledAspects,
  isAspectEnabled,
  getAspectSeverity,
} from './settings-utils';

// ============================================================================
// DTOs and Utility Functions
// ============================================================================

export type {
  MessageSignatureComponents,
  MessageSignatureResult,
  RawValidationMessage,
  NormalizedValidationMessage,
  ValidationResultPerAspectDTO,
  AggregatedValidationResult,
  ValidationMessageGroupDTO,
  ValidationGroupMemberDTO,
  ResourceMessagesDTO,
  ValidationSettingsSnapshot
} from './dtos';

export {
  computeValidationScore,
  aggregateAspectScores,
  normalizeCanonicalPath,
  normalizeMessageText
} from './dtos';

export type {
  ValidationIssueIdentityInput
} from './issue-identity';

export {
  computeValidationIssueId,
  stableStringify
} from './issue-identity';

export type {
  ValidationIssueConfidence,
  ValidationIssueProvenance,
  ValidationIssueProvenanceInput,
  ValidationIssueSourceExecutor,
  ValidationIssueVerificationState,
} from './issue-provenance';

export {
  buildValidationIssueProvenance,
  inferValidationIssueSourceExecutor,
} from './issue-provenance';
