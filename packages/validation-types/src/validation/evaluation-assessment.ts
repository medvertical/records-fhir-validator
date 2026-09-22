import type { ValidationAspect } from './enums.js';

export type EvaluationLaneStatus =
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'not-applicable';

/**
 * PHI-free outcome of the immutable EvaluationPlanSnapshot.
 *
 * The snapshot reports execution coverage for the three product lanes without
 * collapsing their different semantics into a single score. Raw evidence and
 * governance decisions remain in their dedicated persistence stores.
 */
export interface EvaluationAssessmentSnapshot {
  schemaVersion: 1;
  completedAt: string;
  planFingerprint: `sha256:${string}`;
  status: EvaluationLaneStatus;
  observedResources: number;
  expectedResources: number;
  conformance: {
    status: EvaluationLaneStatus;
    enabledAspects: ValidationAspect[];
    anomaly: {
      status: 'completed' | 'not-evaluable' | 'disabled';
      issueCount: number;
      reasons: string[];
    };
    reasons: string[];
  };
  quality: {
    status: EvaluationLaneStatus;
    enabledRuleCount: number;
    metricCount: number;
    findingCount: number;
    reasons: string[];
  };
  governance: {
    status: EvaluationLaneStatus;
    enabledAdvisoryCount: number;
    validationIssueAdvisoryCount: number;
    qualityFindingAdvisoryCount: number;
    qualityApplications: number;
    suppressedQualityFindings: number;
    severityOverrides: number;
    messageOverrides: number;
    conflictCount: number;
    reasons: string[];
  };
  reasons: string[];
}
