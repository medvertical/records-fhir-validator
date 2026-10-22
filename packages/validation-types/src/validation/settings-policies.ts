// ============================================================================
// Advisor Rules
// ============================================================================

/**
 * Match criteria for an advisor rule.
 * All specified fields must match for the rule to apply.
 */
export interface AdvisorRuleMatch {
  code?: string | string[];
  path?: string | string[];
  message?: string;
  messageRegex?: string | string[];
  aspect?: string | string[];
  severity?: string | string[];
  profile?: string | string[];
  ruleId?: string | string[];
  resourceType?: string | string[];
}

/**
 * Transformation to apply when an advisor rule matches.
 */
export interface AdvisorRuleTransform {
  severity?: 'error' | 'warning' | 'information' | 'info';
  message?: string;
}

export interface AdvisorRuleApplication {
  ruleId: string;
  action: AdvisorRule['action'];
  priority: number;
  reason?: string;
  before?: string;
  after?: string;
}

/**
 * Post-validation advisor rule for severity overrides and suppressions.
 * Applied after strictness filtering, before persistence.
 */
export interface AdvisorRule {
  id: string;
  action: 'suppress' | 'override-severity' | 'override-message';
  match: AdvisorRuleMatch;
  transform?: AdvisorRuleTransform;
  reason?: string;
  enabled?: boolean;
  /** Higher values win. Equal-priority conflicts remain deterministic by rule id. */
  priority?: number;
  expiresAt?: string;
  origin?: 'builtin' | 'local' | 'pack';
  sourcePackRef?: string;
  source?: { profileReference?: string; packageId?: string; packageVersion?: string; path?: string; ruleKey?: string };
}

export type ProfileApplicationSource =
  | 'resource-meta'
  | 'explicit-run'
  | 'imposed-policy'
  | 'code-inferred'
  | 'structuredefinition-imposeProfile'
  | 'base-fallback';

export interface ImposedProfilePolicy {
  /** Stable identifier used in reports and audit evidence. */
  id?: string;
  /** Disabled policies are kept for draft/customer-specific configurations. */
  enabled?: boolean;
  /** FHIR resource type to which the profile is applied. Use "*" for all. */
  resourceType: string;
  /** Canonical URL of the profile to validate against. */
  profileUrl: string;
  /** Optional human-readable label shown in UI/report contexts. */
  label?: string;
  /** Optional package evidence when the policy is tied to a pinned IG package. */
  packageId?: string;
  packageVersion?: string;
  /** Optional explanation for why this profile is imposed. */
  reason?: string;
}

export interface ImposedProfilesConfig {
  enabled: boolean;
  policies: ImposedProfilePolicy[];
}
