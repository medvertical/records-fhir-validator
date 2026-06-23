import type { ValidationResult } from './results';

// ============================================================================
// Validation Quality Metrics
// ============================================================================

/**
 * Validation quality metrics
 */
export interface ValidationQualityMetrics {
  overallQualityScore: number; // 0-100
  accuracy: ValidationAccuracyMetrics;
  completeness: ValidationCompletenessMetrics;
  consistency: ValidationConsistencyMetrics;
  performance: ValidationPerformanceMetrics;
  reliability: ValidationReliabilityMetrics;
  aspectQualityScores: Record<string, ValidationAspectQuality>;
  qualityTrends: ValidationQualityTrend[];
  recommendations: ValidationQualityRecommendation[];
}

/**
 * Validation accuracy metrics
 */
export interface ValidationAccuracyMetrics {
  accuracy: number; // 0-1
  truePositiveRate: number; // 0-1
  trueNegativeRate: number; // 0-1
  falsePositiveRate: number; // 0-1
  falseNegativeRate: number; // 0-1
  precision: number; // 0-1
  recall: number; // 0-1
  f1Score: number; // 0-1
  confidence: number; // 0-100
}

/**
 * Validation consistency metrics
 */
export interface ValidationConsistencyMetrics {
  consistencyScore: number; // 0-100
  variance: number;
  standardDeviation: number;
  coefficientOfVariation: number;
}

/**
 * Validation performance metrics
 */
export interface ValidationPerformanceMetrics {
  performanceScore: number; // 0-100
  averageValidationTime: number; // ms
  p50ValidationTime: number; // ms
  p95ValidationTime: number; // ms
  p99ValidationTime: number; // ms
  throughput: number; // resources per second
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
}

/**
 * Validation reliability metrics
 */
export interface ValidationReliabilityMetrics {
  reliabilityScore: number; // 0-100
  uptime: number; // percentage
  errorRate: number; // percentage
  successRate: number; // percentage
  meanTimeBetweenFailures: number; // seconds
  meanTimeToRecovery: number; // seconds
}

// ============================================================================
// Validation Aspect Quality
// ============================================================================

/**
 * Quality metrics for a specific validation aspect
 */
export interface ValidationAspectQuality {
  aspect: string;
  qualityScore: number; // 0-100
  issueCount: number;
  issueSeverityDistribution: {
    fatal: number;
    error: number;
    warning: number;
    information: number;
  };
  coverage: number; // percentage of resources validated
  accuracy: number; // 0-100
  performance: {
    averageTime: number;
    totalTime: number;
    throughput: number;
  };
  trends: any[]; // Historical trend data
}

/**
 * Validation quality trend over time
 */
export interface ValidationQualityTrend {
  timestamp: Date;
  qualityScore: number; // 0-100
  accuracyScore: number; // 0-100
  completenessScore: number; // 0-100
  consistencyScore: number; // 0-100
  performanceScore: number; // 0-100
  reliabilityScore: number; // 0-100
  resourcesValidated: number;
  duration: number; // milliseconds
}

/**
 * Aspect-specific quality trend
 */
export interface ValidationAspectQualityTrend {
  aspect: string;
  dates: Date[];
  scores: number[];
  confidences: number[];
}

/**
 * Validation quality recommendation
 */
export interface ValidationQualityRecommendation {
  type: 'improve' | 'maintain' | 'investigate';
  aspect?: string;
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  actionable: boolean;
  suggestedActions?: string[];
}

/**
 * Validation quality configuration
 */
export interface ValidationQualityConfig {
  thresholds: {
    excellent: number;
    good: number;
    acceptable: number;
    poor: number;
  };
  weights: {
    accuracy: number;
    completeness: number;
    consistency: number;
    performance: number;
    reliability: number;
  };
  minSampleSize: number;
  trendAnalysisWindow: number; // days
  enableRecommendations: boolean;
  monitoringInterval: number; // minutes
}

/**
 * Validation quality report
 */
export interface ValidationQualityReport {
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  qualityMetrics: ValidationQualityMetrics;
  qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  status: 'excellent' | 'good' | 'acceptable' | 'poor' | 'unacceptable';
  keyFindings: string[];
  trendsSummary: string;
  topRecommendations: ValidationQualityRecommendation[];
  benchmarkComparison: {
    current: ValidationQualityMetrics;
    benchmark: ValidationQualityMetrics;
    improvement: number;
  };
  resourceTypeQuality: Record<string, ValidationQualityMetrics>;
  qualityHistory: ValidationQualityTrend[];
}

// ============================================================================
// Validation Confidence
// ============================================================================

/**
 * Factors that influence validation confidence
 */
export interface ValidationConfidenceFactors {
  profileCoverage: number; // 0-100
  terminologyCoverage: number; // 0-100
  referenceResolution: number; // 0-100
  ruleCoverage: number; // 0-100
  dataCompleteness: number; // 0-100
  // Extended properties for confidence scoring service
  aspectCompleteness?: number; // 0-100
  dataSourceQuality?: number; // 0-100
  resultConsistency?: number; // 0-100
  historicalAccuracy?: number; // 0-100
  engineReliability?: number; // 0-100
  resourceComplexity?: number; // 0-100
  externalDependencyReliability?: number; // 0-100
}

/**
 * Confidence information for a validation issue
 */
export interface ValidationConfidenceIssue {
  issueId: string;
  confidence: number; // 0-100
  factors: ValidationConfidenceFactors;
  reasoning: string;
  // Extended properties for confidence scoring service
  type?: string;
  description?: string;
  confidenceImpact?: number;
  severity?: 'low' | 'medium' | 'high';
  relatedAspect?: string;
  resolution?: string;
}

/**
 * Confidence metrics for validation
 */
export interface ValidationConfidenceMetrics {
  overallConfidence: number; // 0-100
  aspectConfidences: {
    structural: number;
    profile: number;
    terminology: number;
    reference: number;
    invariant: number;
    custom_rule: number;
    metadata: number;
  };
  averageConfidence: number;
  minConfidence: number;
  maxConfidence: number;
  // Extended properties for confidence scoring service
  confidenceScore?: number; // 0-100
  confidenceLevel?: 'low' | 'medium' | 'high' | 'very_high';
  confidenceIssues?: ValidationConfidenceIssue[];
  confidenceFactors?: ValidationConfidenceFactors;
  validationCertainty?: number; // 0-100
  confidenceTrend?: 'improving' | 'stable' | 'declining';
  explanation?: string;
  recommendations?: ValidationConfidenceAction[];
}

/**
 * Validation result with confidence information
 */
export interface ValidationResultWithConfidence extends ValidationResult {
  confidence: number;
  confidenceFactors: ValidationConfidenceFactors;
  confidenceIssues: ValidationConfidenceIssue[];
}

/**
 * Action to improve validation confidence
 */
export interface ValidationConfidenceAction {
  type: 'add_profile' | 'add_terminology' | 'resolve_reference' | 'add_rule' | 'improve_data' | 'review_manually' | 'investigate_further' | 'seek_additional_validation' | 'trust_result';
  priority: 'low' | 'medium' | 'high';
  message: string;
  expectedImprovement: number; // percentage points
}

// ============================================================================
// Validation Completeness
// ============================================================================

/**
 * Factors that influence validation completeness
 */
export interface ValidationCompletenessFactors {
  aspectCoverage: number; // 0-100
  resourceTypeCoverage: number; // 0-100
  fieldCoverage: number; // 0-100
  ruleCoverage: number; // 0-100
}

/**
 * Coverage metrics for validation
 */
export interface ValidationCoverageMetrics {
  overallCoverage: number; // 0-100
  aspectCoverages: {
    structural: number;
    profile: number;
    terminology: number;
    reference: number;
    invariant: number;
    custom_rule: number;
    metadata: number;
  };
  resourceTypeCoverages: Record<string, number>;
  fieldCoverages: Record<string, number>;
}

/**
 * Missing validation area
 */
export interface MissingValidationArea {
  type: 'aspect' | 'resource_type' | 'field' | 'rule';
  identifier: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
}

/**
 * Validation gap
 */
export interface ValidationGap {
  id: string;
  type: 'missing_aspect' | 'missing_resource_type' | 'missing_field' | 'missing_rule';
  description: string;
  impact: 'low' | 'medium' | 'high';
  affectedResources: number;
  suggestedAction: string;
}

/**
 * Completeness metrics for validation
 */
export interface ValidationCompletenessMetrics {
  completenessScore: number; // 0-100
  fullValidationCoverage: number; // 0-100
  aspectCoverage: number; // 0-100
  requiredFieldCoverage: number; // 0-100
  optionalFieldCoverage: number; // 0-100
  validationGaps: number;
  missingAreas: string[];
}

/**
 * Validation result with completeness information
 */
export interface ValidationResultWithCompleteness extends ValidationResult {
  completeness: number;
  completenessFactors: ValidationCompletenessFactors;
  gaps: ValidationGap[];
}

/**
 * Action to improve validation completeness
 */
export interface ValidationCompletenessAction {
  type: 'enable_aspect' | 'add_resource_type' | 'add_field' | 'add_rule';
  priority: 'low' | 'medium' | 'high';
  message: string;
  expectedImprovement: number; // percentage points
}
