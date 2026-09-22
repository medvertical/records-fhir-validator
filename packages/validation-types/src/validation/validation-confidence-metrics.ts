import type { ValidationResult } from './results.js';

export interface ValidationConfidenceFactors {
  profileCoverage: number;
  terminologyCoverage: number;
  referenceResolution: number;
  ruleCoverage: number;
  dataCompleteness: number;
  aspectCompleteness?: number;
  dataSourceQuality?: number;
  resultConsistency?: number;
  historicalAccuracy?: number;
  engineReliability?: number;
  resourceComplexity?: number;
  externalDependencyReliability?: number;
}

export interface ValidationConfidenceIssue {
  issueId: string;
  confidence: number;
  factors: ValidationConfidenceFactors;
  reasoning: string;
  type?: string;
  description?: string;
  confidenceImpact?: number;
  severity?: 'low' | 'medium' | 'high';
  relatedAspect?: string;
  resolution?: string;
}

export interface ValidationConfidenceMetrics {
  overallConfidence: number;
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
  confidenceScore?: number;
  confidenceLevel?: 'low' | 'medium' | 'high' | 'very_high';
  confidenceIssues?: ValidationConfidenceIssue[];
  confidenceFactors?: ValidationConfidenceFactors;
  validationCertainty?: number;
  confidenceTrend?: 'improving' | 'stable' | 'declining';
  explanation?: string;
  recommendations?: ValidationConfidenceAction[];
}

export interface ValidationResultWithConfidence extends ValidationResult {
  confidence: number;
  confidenceFactors: ValidationConfidenceFactors;
  confidenceIssues: ValidationConfidenceIssue[];
}

export interface ValidationConfidenceAction {
  type:
    | 'add_profile'
    | 'add_terminology'
    | 'resolve_reference'
    | 'add_rule'
    | 'improve_data'
    | 'review_manually'
    | 'investigate_further'
    | 'seek_additional_validation'
    | 'trust_result';
  priority: 'low' | 'medium' | 'high';
  message: string;
  expectedImprovement: number;
}
