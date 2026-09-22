import type {
  QualityAdvisoryRuleDefinition,
  QualityComparisonClass,
  QualityRuleDefinition,
  QualityRuleOverride,
  QualityRuleSeverity,
} from './quality-rule-pack.js';

export interface EffectiveQualityRule {
  packId: string;
  packVersion: string;
  rule: QualityRuleDefinition;
  enabled: boolean;
  effectiveSeverity: QualityRuleSeverity;
  effectiveThreshold?: QualityRuleOverride['threshold'];
  waiver?: QualityRuleOverride['waiver'];
}

export interface EffectiveQualityAdvisoryRule {
  packId: string;
  packVersion: string;
  comparisonClass: QualityComparisonClass;
  rule: QualityAdvisoryRuleDefinition;
  enabled: boolean;
}

export interface EffectiveQualityPolicyLayerReference {
  scope: 'workspace' | 'site' | 'server' | 'environment';
  scopeId: string;
  revision: number;
}

export interface EffectiveQualityPolicySnapshot {
  schemaVersion: 1;
  capturedAt: string;
  organizationId: number;
  siteId: number;
  serverId: number;
  environment: string;
  /** Defaults to true for snapshots captured before scoped DQA enablement existed. */
  qualityAssessmentEnabled?: boolean;
  commonBaselineFingerprint: `sha256:${string}`;
  localExtensionsFingerprint: `sha256:${string}`;
  effectivePolicyFingerprint: `sha256:${string}`;
  packs: Array<{
    id: string;
    version: string;
    manifestHash: `sha256:${string}`;
    comparisonClass: QualityComparisonClass;
  }>;
  rules: EffectiveQualityRule[];
  advisories: EffectiveQualityAdvisoryRule[];
  appliedLayers: EffectiveQualityPolicyLayerReference[];
  applicabilityDecisions: Array<{
    packRef: string;
    outcome: 'applied' | 'skipped';
    reasons: string[];
    /** The layer that most recently assigned, re-enabled, or disabled this pack. */
    assignedBy?: EffectiveQualityPolicyLayerReference;
  }>;
}
