/**
 * Advisor Rules Engine
 *
 * User-configurable post-validation rules that transform, suppress, or
 * override validation issue severity. Compatible with gematik
 * Referenzvalidator plugin YAML v2.0 format (severityLevelFrom/To,
 * locatorString, messageId matching).
 *
 * Advisor rules run AFTER the validator returns raw issues and AFTER
 * strictness-severity is applied. They are the last transform before
 * results are persisted.
 *
 * Rules are loaded from:
 *   1. ValidationSettings.advisorRules (loaded from advisor_rules, managed via UI)
 *   2. .records-advisor.yaml (project-local file)
 *   3. CLI --advisor-rules flag
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { AdvisorRule, AdvisorRuleMatch, AdvisorRuleTransform } from '@records-fhir/validation-types';
import { logger } from '../logger';

// Re-export shared types so existing server imports continue to work
export type { AdvisorRule, AdvisorRuleMatch, AdvisorRuleTransform };

export interface AdvisorRuleSet {
  version: '1.0';
  rules: AdvisorRule[];
}

export interface AdvisorRuleApplicationResult {
  originalIssues: number;
  suppressedCount: number;
  overriddenCount: number;
  resultIssues: ValidationIssue[];
  appliedRules: Array<{ ruleId: string; issueCode: string; action: string }>;
}

// ============================================================================
// gematik YAML v2.0 compatibility types
// ============================================================================

export interface GematikPluginYaml {
  configSpecVersion: '2.0';
  fhirPackage?: Array<{ packageName: string; packageVersion: string }>;
  validationMessageTransformations?: GematikTransformation[];
}

export interface GematikTransformation {
  severityLevelFrom: string;
  severityLevelTo: string;
  locatorString?: string;
  messageId?: string;
}

// ============================================================================
// Rule Matching
// ============================================================================

function matchesRule(issue: ValidationIssue, match: AdvisorRuleMatch): boolean {
  if (match.code) {
    const codes = Array.isArray(match.code) ? match.code : [match.code];
    if (!codes.some(c => issue.code === c || issue.code?.startsWith(c))) return false;
  }

  if (match.path) {
    const paths = Array.isArray(match.path) ? match.path : [match.path];
    if (!paths.some(p => issue.path === p || issue.path?.includes(p))) return false;
  }

  if (match.message) {
    if (!issue.message?.includes(match.message)) return false;
  }

  if (match.aspect) {
    const aspects = Array.isArray(match.aspect) ? match.aspect : [match.aspect];
    if (!aspects.some(a => (issue as any).aspect === a)) return false;
  }

  if (match.severity) {
    if (issue.severity !== match.severity) return false;
  }

  if (match.profile) {
    if (issue.profile !== match.profile && !issue.profile?.includes(match.profile)) return false;
  }

  if (match.resourceType) {
    const types = Array.isArray(match.resourceType) ? match.resourceType : [match.resourceType];
    if (!types.some(t => issue.path?.startsWith(t))) return false;
  }

  return true;
}

// ============================================================================
// Rule Application
// ============================================================================

export function applyAdvisorRules(
  issues: ValidationIssue[],
  rules: AdvisorRule[],
): AdvisorRuleApplicationResult {
  const enabledRules = rules.filter(r => r.enabled !== false);
  if (enabledRules.length === 0) {
    return {
      originalIssues: issues.length,
      suppressedCount: 0,
      overriddenCount: 0,
      resultIssues: issues,
      appliedRules: [],
    };
  }

  const resultIssues: ValidationIssue[] = [];
  const appliedRules: Array<{ ruleId: string; issueCode: string; action: string }> = [];
  let suppressedCount = 0;
  let overriddenCount = 0;

  for (const issue of issues) {
    let suppressed = false;
    let transformed = issue;

    for (const rule of enabledRules) {
      if (!matchesRule(issue, rule.match)) continue;

      switch (rule.action) {
        case 'suppress':
          suppressed = true;
          suppressedCount++;
          appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: 'suppress' });
          break;

        case 'override-severity':
          if (rule.transform?.severity) {
            transformed = { ...transformed, severity: rule.transform.severity };
            overriddenCount++;
            appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: `severity:${issue.severity}->${rule.transform.severity}` });
          }
          break;

        case 'override-message':
          if (rule.transform?.message) {
            transformed = { ...transformed, message: rule.transform.message };
            overriddenCount++;
            appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: 'message-override' });
          }
          break;
      }

      if (suppressed) break;
    }

    if (!suppressed) {
      resultIssues.push(transformed);
    }
  }

  if (appliedRules.length > 0) {
    logger.info(
      `[AdvisorRules] Applied ${appliedRules.length} rule(s): ` +
      `${suppressedCount} suppressed, ${overriddenCount} overridden`,
    );
  }

  return {
    originalIssues: issues.length,
    suppressedCount,
    overriddenCount,
    resultIssues,
    appliedRules,
  };
}

// ============================================================================
// gematik YAML v2.0 Import
// ============================================================================

export function convertGematikRules(gematik: GematikPluginYaml): AdvisorRule[] {
  if (!gematik.validationMessageTransformations) return [];

  return gematik.validationMessageTransformations.map((t, i) => ({
    id: `gematik-${i + 1}`,
    action: t.severityLevelTo === 'ignore' ? 'suppress' as const : 'override-severity' as const,
    match: {
      severity: t.severityLevelFrom.toLowerCase(),
      ...(t.locatorString ? { path: t.locatorString } : {}),
      ...(t.messageId ? { code: t.messageId } : {}),
    },
    transform: t.severityLevelTo !== 'ignore' ? {
      severity: t.severityLevelTo.toLowerCase() as 'error' | 'warning' | 'information',
    } : undefined,
    reason: `Imported from gematik plugin (transformation ${i + 1})`,
    enabled: true,
  }));
}

// ============================================================================
// Firely QC YAML Import (basic compatibility)
// ============================================================================

export interface FirelyQCRule {
  action: 'suppress' | 'error';
  issue?: string;
  expression?: string;
}

export function convertFirelyQCRules(rules: FirelyQCRule[]): AdvisorRule[] {
  return rules.map((r, i) => ({
    id: `firely-qc-${i + 1}`,
    action: r.action === 'suppress' ? 'suppress' as const : 'override-severity' as const,
    match: {
      ...(r.issue ? { code: r.issue } : {}),
      ...(r.expression ? { message: r.expression } : {}),
    },
    transform: r.action === 'error' ? { severity: 'error' as const } : undefined,
    reason: `Imported from Firely QC rule ${i + 1}`,
    enabled: true,
  }));
}
