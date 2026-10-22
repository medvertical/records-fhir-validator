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

interface OriginalQualityProgramBasis {
  packRef: string;
  origin: 'original-cql' | 'original-r';
  moduleId: string;
  definitionFingerprint: `sha256:${string}`;
  manifestFingerprint: `sha256:${string}`;
  artifactBundleFingerprint: `sha256:${string}`;
  dependenciesFingerprint: `sha256:${string}`;
  runtimeTreeSha256: string;
  executionCapsuleFingerprint?: `sha256:${string}`;
  qualified: false;
  execution: 'blocked';
}

interface OriginalQualityRunBasis {
  schemaVersion: 'records-original-quality-run-basis/1';
  jobId: string;
  executionClock: string;
  clockBasis: 'captured-policy-clock';
  organizationId: number;
  siteId: number;
  serverId: number;
  environment: string;
  fhirVersion: string | null;
  sourceConfigurationGeneration: { state: 'known'; value: string } | { state: 'unknown' };
  effectivePolicyFingerprint: `sha256:${string}`;
  settingsHash: string;
  programs: OriginalQualityProgramBasis[];
  selection: {
    resourceTypes: string[] | null;
    requestedResourceLimit: number | null;
    searchFiltersHash: string | null;
    scopeRestoration: 'complete' | 'input-required' | 'legacy';
    requestFingerprint: `sha256:${string}`;
    membershipCaptured: false;
  };
  execution: 'blocked';
  sourceSnapshotGuaranteed: false;
  fingerprint: `sha256:${string}`;
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
  runConstraints?: { qualityAssessmentRequired: boolean; requiredPacks: string[] };
  runContext?: {
    basePolicyFingerprint: `sha256:${string}`;
    mode: 'inherit' | 'on' | 'off';
    packRefs?: string[];
  };
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
  /** Exact installed Original metadata, not native rules or execution permission. */
  originalPrograms?: OriginalQualityProgramBasis[];
  /** Absent on historical/preflight snapshots; never reconstructed from current configuration. */
  originalRunBasis?: OriginalQualityRunBasis;
  appliedLayers: EffectiveQualityPolicyLayerReference[];
  applicabilityDecisions: Array<{
    packRef: string;
    outcome: 'applied' | 'skipped';
    reasons: string[];
    /** The layer that most recently assigned, re-enabled, or disabled this pack. */
    assignedBy?: EffectiveQualityPolicyLayerReference;
  }>;
}
