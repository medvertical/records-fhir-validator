import type {
  QualityAdvisoryAction,
  QualityComparisonClass,
  QualityFindingDisposition,
  QualityNormativeStatus,
  QualityRuleOutcome,
  QualityRuleScope,
  QualityRuleSeverity,
} from './quality-rule-pack.js';

export interface QualityAdvisoryApplication {
  packId: string;
  packVersion: string;
  ruleId: string;
  priority: number;
  action: QualityAdvisoryAction;
  reason: string;
  before?: string;
  after?: string;
}

export interface QualityAdvisoryConflict {
  findingKey: string;
  dimension: 'severity' | 'message';
  priority: number;
  ruleRefs: string[];
  competingValues: string[];
}

export interface QualityAdvisorySummary {
  activeFindings: number;
  suppressedFindings: number;
  severityOverrides: number;
  messageOverrides: number;
  conflicts: QualityAdvisoryConflict[];
}

export interface QualityRuleFinding {
  packId: string;
  packVersion: string;
  ruleId: string;
  category: string;
  scope: QualityRuleScope;
  comparisonClass: QualityComparisonClass;
  rawSeverity: QualityRuleSeverity;
  severity: QualityRuleSeverity;
  normativeStatus: QualityNormativeStatus;
  outcome: QualityRuleOutcome;
  rawMessage: string;
  message: string;
  disposition: QualityFindingDisposition;
  advisoryApplications: QualityAdvisoryApplication[];
  resourceType?: string;
  resourceId?: string;
  evidence: {
    paths: string[];
    resourceKeys: string[];
    details?: Record<string, unknown>;
  };
}

export interface QualityMetric {
  metricType: 'assertion' | 'distribution';
  packId: string;
  packVersion: string;
  ruleId: string;
  category: string;
  comparisonClass: QualityComparisonClass;
  numerator: number;
  denominator: number;
  eligible: number;
  evaluated: number;
  notEvaluable: number;
  value: number | null;
  strata: Array<{
    key: `sha256:${string}`;
    count: number;
    system?: string;
    code?: string;
  }>;
  otherCount: number;
  threshold?: { operator: 'gte' | 'gt' | 'lte' | 'lt' | 'eq'; value: number; unit: 'ratio' | 'percent' | 'count' };
  outcome: QualityRuleOutcome;
}

export interface QualityAssessmentSnapshot {
  schemaVersion: 1;
  status: 'completed' | 'incomplete' | 'failed' | 'not-applicable';
  completedAt: string;
  policyFingerprint: `sha256:${string}`;
  commonBaselineFingerprint: `sha256:${string}`;
  localExtensionsFingerprint: `sha256:${string}`;
  scopeFingerprint: string;
  sourceScopeFingerprint?: string;
  selectionStrategy?: 'complete-selected-scope' | 'sampled-selected-scope';
  selectionReason?: string;
  timeWindowFingerprint: `sha256:${string}`;
  observedResources: number;
  expectedResources: number;
  findingCount: number;
  truncatedFindingCount: number;
  metrics: QualityMetric[];
  reasons: string[];
}
