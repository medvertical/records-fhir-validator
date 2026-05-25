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

export {
  DEFAULT_VALIDATION_STRICTNESS,
  VALIDATION_ASPECTS,
  VALIDATION_ASPECT_LABELS,
  VALIDATION_ASPECT_DESCRIPTIONS
} from './enums';

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
  ValidationCompletenessAction
} from './results';

// ============================================================================
// Settings and Configuration
// ============================================================================

export type {
  ProfileSourcesConfig,
  ValidationAspectConfig,
  TerminologyServer,
  CircuitBreakerConfig,
  ValidationSettings,
  ValidationSettingsUpdate,
  ValidationSettingsValidationResult,
  FHIRResourceTypeConfig,
  AdvisorRule,
  AdvisorRuleMatch,
  AdvisorRuleTransform
} from './settings';

export { PERFORMANCE_LIMITS } from './settings';

export {
  createEhds2026ValidationSettings,
  createMii2026ValidationSettings,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  type FhirPackagePin,
  type Mii2026ValidationSettingsOverrides,
  type MiiTerminologyMode
} from './settings-defaults';

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
