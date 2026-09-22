import type { ValidationResult } from './results.js';

export interface ValidationCompletenessFactors {
  aspectCoverage: number;
  resourceTypeCoverage: number;
  fieldCoverage: number;
  ruleCoverage: number;
}

export interface ValidationCoverageMetrics {
  overallCoverage: number;
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

export interface MissingValidationArea {
  type: 'aspect' | 'resource_type' | 'field' | 'rule';
  identifier: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
}

export interface ValidationGap {
  id: string;
  type: 'missing_aspect' | 'missing_resource_type' | 'missing_field' | 'missing_rule';
  description: string;
  impact: 'low' | 'medium' | 'high';
  affectedResources: number;
  suggestedAction: string;
}

export interface ValidationCompletenessMetrics {
  completenessScore: number;
  fullValidationCoverage: number;
  aspectCoverage: number;
  requiredFieldCoverage: number;
  optionalFieldCoverage: number;
  validationGaps: number;
  missingAreas: string[];
}

export interface ValidationResultWithCompleteness extends ValidationResult {
  completeness: number;
  completenessFactors: ValidationCompletenessFactors;
  gaps: ValidationGap[];
}

export interface ValidationCompletenessAction {
  type: 'enable_aspect' | 'add_resource_type' | 'add_field' | 'add_rule';
  priority: 'low' | 'medium' | 'high';
  message: string;
  expectedImprovement: number;
}
