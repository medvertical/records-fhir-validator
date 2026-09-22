import type { ValidationCompletenessMetrics } from './validation-completeness-metrics.js';

export interface ValidationQualityMetrics {
  overallQualityScore: number;
  accuracy: ValidationAccuracyMetrics;
  completeness: ValidationCompletenessMetrics;
  consistency: ValidationConsistencyMetrics;
  performance: ValidationPerformanceMetrics;
  reliability: ValidationReliabilityMetrics;
  aspectQualityScores: Record<string, ValidationAspectQuality>;
  qualityTrends: ValidationQualityTrend[];
  recommendations: ValidationQualityRecommendation[];
}

export interface ValidationAccuracyMetrics {
  accuracy: number;
  truePositiveRate: number;
  trueNegativeRate: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  confidence: number;
}

export interface ValidationConsistencyMetrics {
  consistencyScore: number;
  variance: number;
  standardDeviation: number;
  coefficientOfVariation: number;
}

export interface ValidationPerformanceMetrics {
  performanceScore: number;
  averageValidationTime: number;
  p50ValidationTime: number;
  p95ValidationTime: number;
  p99ValidationTime: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage: number;
}

export interface ValidationReliabilityMetrics {
  reliabilityScore: number;
  uptime: number;
  errorRate: number;
  successRate: number;
  meanTimeBetweenFailures: number;
  meanTimeToRecovery: number;
}

export interface ValidationAspectQuality {
  aspect: string;
  qualityScore: number;
  issueCount: number;
  issueSeverityDistribution: {
    fatal: number;
    error: number;
    warning: number;
    information: number;
  };
  coverage: number;
  accuracy: number;
  performance: {
    averageTime: number;
    totalTime: number;
    throughput: number;
  };
  trends: ValidationQualityTrend[];
}

export interface ValidationQualityTrend {
  timestamp: Date;
  qualityScore: number;
  accuracyScore: number;
  completenessScore: number;
  consistencyScore: number;
  performanceScore: number;
  reliabilityScore: number;
  resourcesValidated: number;
  duration: number;
}

export interface ValidationAspectQualityTrend {
  aspect: string;
  dates: Date[];
  scores: number[];
  confidences: number[];
}

export interface ValidationQualityRecommendation {
  type: 'improve' | 'maintain' | 'investigate';
  aspect?: string;
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  actionable: boolean;
  suggestedActions?: string[];
}

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
  trendAnalysisWindow: number;
  enableRecommendations: boolean;
  monitoringInterval: number;
}

export interface ValidationQualityReport {
  generatedAt: Date;
  period: { start: Date; end: Date };
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
