import type { ValidationAspect } from './enums.js';
import type { QualityRuleScope } from './quality-rule-pack.js';

export type EvaluationScopeRequirement = 'selected-scope' | 'complete-selected-scope';

/**
 * PHI-free, immutable execution contract for one validation run.
 *
 * The plan deliberately references the larger validation/settings artifacts by
 * fingerprint. Callers can decide what will execute without learning the
 * validator, DQA evaluator, or governance implementations.
 */
export interface EvaluationPlanSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  planFingerprint: `sha256:${string}`;
  validationLockHash: `sha256:${string}`;
  organizationId: number;
  siteId: number;
  serverId: number;
  environment: string;
  scope: {
    fingerprint: string;
    cohortFingerprint: string;
    totalResources: number;
    requirement: EvaluationScopeRequirement;
  };
  conformance: {
    enabledAspects: ValidationAspect[];
    resourceAspects: Exclude<ValidationAspect, 'anomaly'>[];
    batchAspects: Extract<ValidationAspect, 'anomaly'>[];
  };
  quality: {
    policyFingerprint: `sha256:${string}`;
    commonBaselineFingerprint: `sha256:${string}`;
    localExtensionsFingerprint: `sha256:${string}`;
    packs: Array<{
      id: string;
      version: string;
      manifestHash: `sha256:${string}`;
      comparisonClass: 'common-baseline' | 'local-extension';
    }>;
    enabledRuleCount: number;
    scopes: QualityRuleScope[];
  };
  governance: {
    enabledAdvisoryCount: number;
    validationIssueAdvisoryCount: number;
    qualityFindingAdvisoryCount: number;
  };
}
