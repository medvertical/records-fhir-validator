import type { FindingSourceSummary } from './finding-source.js';

export type ValidationIssueSummarySeverity = 'error' | 'warning' | 'information';

export interface ValidationIssueSummaryScopeV1 {
  source: 'current' | 'live' | 'run' | 'browsed' | 'demo';
  serverId?: number;
  environment?: string;
  runId?: number;
}

export interface ValidationIssueSeverityMetricsV1 {
  issueTypes: number;
  occurrences: number;
  affectedResources: number;
}

export interface ValidationIssueResourceTypeMetricsV1 {
  resourceType: string;
  affectedResources: number;
  bySeverity: Record<ValidationIssueSummarySeverity, number>;
}

export interface ValidationIssueMetricDimensionsV1 {
  distinctIssueTypes: {
    total: number;
    bySeverity: Record<ValidationIssueSummarySeverity, number>;
  };
  /** Distinct validator error/rule codes, independent of path and occurrence. */
  distinctIssueCodes?: {
    total: number;
    bySeverity: Record<ValidationIssueSummarySeverity, number>;
  };
  issueOccurrences: {
    total: number;
    bySeverity: Record<ValidationIssueSummarySeverity, number>;
  };
  affectedResources: {
    total: number;
    bySeverity: Record<ValidationIssueSummarySeverity, number>;
  };
  validatedResources: {
    total: number | null;
  };
}

/**
 * Complete, unpaginated issue metrics for one explicit inventory/run scope.
 * List endpoints may be bounded; this summary must never be derived from a
 * page of groups.
 */
export interface ValidationIssueSummaryMetrics {
  totalGroups: number;
  occurrences: number;
  totalResourcesValidated: number | null;
  affectedResources: number;
  affectedResourcePercent: number | null;
  bySeverity: Record<ValidationIssueSummarySeverity, number>;
  severityMetrics: Record<ValidationIssueSummarySeverity, ValidationIssueSeverityMetricsV1>;
  byAspect: Array<{
    aspect: string;
    issueGroups: number;
    affectedResourceHits: number;
  }>;
  affectedResourceTypes: number;
  topResourceTypes: Array<{
    resourceType: string;
    affectedResources: number;
  }>;
  /** Complete affected-resource inventory by resource type and severity. */
  resourceTypeMetrics?: ValidationIssueResourceTypeMetricsV1[];
  largestCluster: {
    signature: string;
    aspect: string;
    severity: ValidationIssueSummarySeverity;
    code?: string;
    canonicalPath: string;
    sampleMessage: string;
    affectedResources: number;
    resourceType?: string;
  } | null;
  /** Per-origin accounting for combined finding inventories. */
  findingSources?: FindingSourceSummary[];
  /** Whether affectedResources is a unique cardinality or an additive per-source total. */
  affectedResourceSemantics?: 'unique-resources' | 'source-hits';
}

export interface ValidationIssueSummaryV1 extends ValidationIssueSummaryMetrics {
  version: 1;
  scope: ValidationIssueSummaryScopeV1;
  /** Explicit count dimensions; flat fields remain as the V1 compatibility surface. */
  metrics: ValidationIssueMetricDimensionsV1;
}
