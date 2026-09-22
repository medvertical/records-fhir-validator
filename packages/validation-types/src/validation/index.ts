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
} from './enums.js';

export type { ValidationAspectType } from './aspect-enums.js';
export {
  FindingSource,
  type FindingAspectType,
  type FindingSourceSeverityCounts,
  type FindingSourceSummary,
  type FindingSourceType,
} from './finding-source.js';

export {
  DEFAULT_VALIDATION_STRICTNESS,
  VALIDATION_ASPECTS,
  VALIDATION_ASPECT_LABELS,
  VALIDATION_ASPECT_DESCRIPTIONS,
  isErrorValidationSeverity,
  isInformationValidationSeverity,
} from './enums.js';

export {
  CANONICAL_CUSTOM_RULE_ASPECT,
  normalizeValidationAspect,
  normalizeValidationAspects,
  normalizeValidationSettings
} from './aspect-aliases.js';

export type {
  ValidationIssue,
  ValidationIssueTarget,
  ValidationError,
  ValidationRetryInfo,
  ValidationRetryAttempt
} from './messages.js';

export { calculateValidationIssueScore } from './scoring.js';
export type {
  ValidationResult,
  ValidationAspectResult,
  EnhancedValidationSummary,
  ValidationProgress,
  ValidationRunSummary,
  ValidationMetrics,
} from './results.js';

export type {
  ValidationRunActivityEventSnapshot,
  ValidationRunInFlightResourceTypeSnapshot,
  ValidationRunLifecycleStatus,
  ValidationRunOutcome,
  ValidationRunResourceTypeSnapshot,
  ValidationRunSnapshotV1,
  ValidationRunTerminationCause,
} from './run-snapshot.js';

export type { EvaluationPlanSnapshot, EvaluationScopeRequirement } from './evaluation-plan.js';
export type { EvaluationAssessmentSnapshot, EvaluationLaneStatus } from './evaluation-assessment.js';

export type {
  ValidationIssueResourceTypeMetricsV1,
  ValidationIssueSeverityMetricsV1,
  ValidationIssueSummaryMetrics,
  ValidationIssueSummaryScopeV1,
  ValidationIssueSummarySeverity,
  ValidationIssueSummaryV1,
} from './issue-summary.js';

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
} from './validation-advanced-metrics.js';

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
  MiiPreset,
  MiiValidationSettings,
  ProfileApplicationSource,
  ImposedProfilePolicy,
  ImposedProfilesConfig,
  AdvisorRule,
  AdvisorRuleApplication,
  AdvisorRuleMatch,
  AdvisorRuleTransform
} from './settings.js';

export type {
  CredentialPresenceHints,
  PublicTerminologyAuthConfig,
  PublicTerminologyServer,
  PublicValidationSettings,
} from './settings-public.js';

export { PERFORMANCE_LIMITS } from './settings.js';

export {
  COMMON_FHIR_RESOURCE_TYPES,
  CONFORMANCE_RESOURCE_TYPES,
  R4_ALL_RESOURCE_TYPES,
  R5_ALL_RESOURCE_TYPES,
  R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
  R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
  type CommonFhirResourceType,
} from './settings-types.js';

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
  FHIR_CORE_PACKAGE_SET,
  FHIR_CORE_PACKAGE_VERSIONS,
  FHIR_CORE_EXTENSION_PACKAGE_SET,
  FHIR_CORE_EXTENSION_PACKAGE_VERSIONS,
  FHIR_CORE_TERMINOLOGY_PACKAGE_SET,
  FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE,
  IPS_PACKAGE_VERSION,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  type FhirPackagePin,
  type Mii2026ValidationSettingsOverrides,
  type MiiTerminologyMode
} from './settings-defaults.js';

export {
  BUNDLED_PROFILE_PRESETS,
  getBundledProfilePlan,
  isBundledProfilePreset,
  parseBundledProfilePreset,
  type BundledProfilePlan,
  type BundledProfilePreset,
} from './defaults/bundled-profile-plan.js';

export {
  validatePerformanceSettings,
  validateResourceTypeSettings,
  validateResourceTypeSettingsForVersion,
  validateValidationSettings,
} from './settings-validators.js';

export {
  DEFAULT_PROFILE_SOURCES_CONFIG,
  normalizeProfileSourcesConfig,
  parseSettings,
  parseSettingsUpdate,
  safeParseSettings,
  safeParseSettingsUpdate,
  ValidationSettingsSchema,
  ValidationSettingsUpdateSchema,
} from './settings-schema.js';

export {
  getAllResourceTypesForVersion,
  getDefaultIncludedTypesForVersion,
  isResourceTypeAvailableInVersion,
  getUnavailableResourceTypes,
  getR5SpecificResourceTypes,
  migrateResourceTypesForVersion,
  getEffectiveResourceTypes,
  shouldValidateResourceType,
} from './settings-transformers.js';

export {
  decideResourceValidationEligibility,
  planResourceValidation,
  type PlannedResourceValidation,
  type PlannedResourceValidationSkip,
  type ResourceTypeValidationPolicy,
  type ResourceValidationEligibilityDecision,
  type ResourceValidationEligibilityReason,
  type ResourceValidationOperation,
  type ResourceValidationPolicyAnnotation,
} from './resource-validation-eligibility.js';

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
} from './settings-utils.js';

// ============================================================================
// Versioned quality rule packs
// ============================================================================

export {
  QUALITY_NORMATIVE_STATUSES,
  QUALITY_ADVISORY_ACTIONS,
  QUALITY_FINDING_DISPOSITIONS,
  QUALITY_RULE_OUTCOMES,
  QUALITY_RULE_SCOPES,
  QUALITY_RULE_SEVERITIES,
  parseQualityRulePackManifest,
  qualityPolicyLayerSchema,
  qualityAdvisoryRuleDefinitionSchema,
  qualityRuleDefinitionSchema,
  qualityRuleImplementationSchema,
  qualityRulePackManifestSchema,
  qualityReferenceSetDefinitionSchema,
  qualityRuleOverrideSchema,
  type QualityComparisonClass,
  type QualityAdvisoryAction,
  type QualityAdvisoryRuleDefinition,
  type QualityFindingDisposition,
  type QualityNormativeStatus,
  type QualityPolicyLayer,
  type QualityRuleDefinition,
  type QualityRuleImplementation,
  type QualityRuleOutcome,
  type QualityRuleOverride,
  type QualityRulePackManifest,
  type QualityReferenceSetDefinition,
  type QualityRuleScope,
  type QualityRuleSeverity,
} from './quality-rule-pack.js';
export type {
  EffectiveQualityAdvisoryRule,
  EffectiveQualityPolicyLayerReference,
  EffectiveQualityPolicySnapshot,
  EffectiveQualityRule,
} from './effective-quality-policy.js';
export type {
  QualityAdvisoryApplication,
  QualityAdvisoryConflict,
  QualityAdvisorySummary,
  QualityAssessmentSnapshot,
  QualityMetric,
  QualityRuleFinding,
} from './quality-assessment.js';
export {
  parseQualityRulePackDraftManifest,
  qualityRulePackDraftManifestSchema,
  type QualityRulePackDraftManifest,
  type QualityRulePackDraftTestSummary,
} from './quality-rule-pack-draft.js';

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
} from './dtos.js';

export {
  computeValidationScore,
  aggregateAspectScores,
  normalizeCanonicalPath,
  normalizeMessageText
} from './dtos.js';

export { removeAsciiControlCharacters } from './text-normalization.js';

export type { ValidationIssueIdentityInput } from './issue-identity.js';

export {
  computeValidationIssueId,
  stableStringify
} from './issue-identity.js';

export {
  getEffectiveIssueRuleId,
  getSpecificIssueRuleId,
  type IssueRuleIdentityInput,
} from './issue-rule-id.js';

export type {
  ValidationIssueConfidence,
  ValidationIssueProvenance,
  ValidationIssueProvenanceInput,
  ValidationIssueSourceExecutor,
  ValidationIssueVerificationState,
} from './issue-provenance.js';

export {
  buildValidationIssueProvenance,
  inferValidationIssueSourceExecutor,
} from './issue-provenance.js';
