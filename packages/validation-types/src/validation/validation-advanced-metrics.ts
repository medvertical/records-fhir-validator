/**
 * Compatibility facade for the historical advanced-metrics module.
 * New internal code should import the focused quality, confidence, or
 * completeness contract directly.
 */
export type {
  ValidationAccuracyMetrics,
  ValidationAspectQuality,
  ValidationAspectQualityTrend,
  ValidationConsistencyMetrics,
  ValidationPerformanceMetrics,
  ValidationQualityConfig,
  ValidationQualityMetrics,
  ValidationQualityRecommendation,
  ValidationQualityReport,
  ValidationQualityTrend,
  ValidationReliabilityMetrics,
} from './validation-quality-metrics.js';

export type {
  ValidationConfidenceAction,
  ValidationConfidenceFactors,
  ValidationConfidenceIssue,
  ValidationConfidenceMetrics,
  ValidationResultWithConfidence,
} from './validation-confidence-metrics.js';

export type {
  MissingValidationArea,
  ValidationCompletenessAction,
  ValidationCompletenessFactors,
  ValidationCompletenessMetrics,
  ValidationCoverageMetrics,
  ValidationGap,
  ValidationResultWithCompleteness,
} from './validation-completeness-metrics.js';
