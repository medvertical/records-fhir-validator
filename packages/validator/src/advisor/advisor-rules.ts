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

import type {
  AdvisorRule,
  AdvisorRuleApplication,
  AdvisorRuleMatch,
  AdvisorRuleTransform,
  ValidationIssue,
} from '@records-fhir/validation-types';
import { logger } from '../logger.js';

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
  evidenceIssues: ValidationIssue[];
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
    if (!codes.some((code: string) => issue.code === code || issue.code?.startsWith(code))) return false;
  }

  if (match.path) {
    const paths = Array.isArray(match.path) ? match.path : [match.path];
    if (!paths.some((path: string) => issue.path === path || issue.path?.includes(path))) return false;
  }

  if (match.message) {
    if (!issue.message?.includes(match.message)) return false;
  }

  if (match.messageRegex) {
    const patterns = Array.isArray(match.messageRegex) ? match.messageRegex : [match.messageRegex];
    if (!patterns.some((pattern: string) => matchesRegex(issue.message, pattern))) return false;
  }

  if (match.aspect) {
    const aspects = Array.isArray(match.aspect) ? match.aspect : [match.aspect];
    if (!aspects.some((aspect: string) => issue.aspect === aspect)) return false;
  }

  if (match.severity) {
    const severities = Array.isArray(match.severity) ? match.severity : [match.severity];
    if (!severities.includes(issue.severity)) return false;
  }

  if (match.profile) {
    const profiles = Array.isArray(match.profile) ? match.profile : [match.profile];
    if (!profiles.some(profile => issue.profile === profile || issue.profile?.includes(profile))) return false;
  }

  if (match.ruleId) {
    const ruleIds = Array.isArray(match.ruleId) ? match.ruleId : [match.ruleId];
    if (!ruleIds.some(ruleId => issue.ruleId === ruleId || issue.ruleId?.startsWith(ruleId))) return false;
  }

  if (match.resourceType) {
    const types = Array.isArray(match.resourceType) ? match.resourceType : [match.resourceType];
    if (!types.some((resourceType: string) => issue.path?.startsWith(resourceType))) return false;
  }

  return true;
}

/**
 * Patterns already reported as uncompilable. Rule matching runs per issue, so
 * without this a single broken rule would log once per finding.
 */
const reportedInvalidPatterns = new Set<string>();

function matchesRegex(value: string | undefined, pattern: string): boolean {
  if (!value) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // A rule whose pattern does not compile never matches anything. Staying
    // silent about it makes the rule look applied when it was never evaluated.
    if (!reportedInvalidPatterns.has(pattern)) {
      reportedInvalidPatterns.add(pattern);
      logger.warn(
        '[AdvisorRules] Ignoring a rule match: messageRegex is not a valid regular expression',
        { messageRegex: pattern },
      );
    }
    return false;
  }
}

/** Test seam: rule sets change between runs, so the report-once memory must reset. */
export function resetAdvisorRuleDiagnostics(): void {
  reportedInvalidPatterns.clear();
}

// ============================================================================
// Rule Application
// ============================================================================

export function applyAdvisorRules(
  issues: ValidationIssue[],
  rules: AdvisorRule[],
): AdvisorRuleApplicationResult {
  const now = Date.now();
  const enabledRules = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false
      && (!rule.expiresAt || Date.parse(rule.expiresAt) > now))
    .sort((left, right) => (right.rule.priority ?? 0) - (left.rule.priority ?? 0)
      || left.rule.id.localeCompare(right.rule.id)
      || left.index - right.index)
    .map(({ rule }) => rule);
  if (enabledRules.length === 0) {
    return {
      originalIssues: issues.length,
      suppressedCount: 0,
      overriddenCount: 0,
      resultIssues: issues,
      evidenceIssues: issues.map(withRawEvidence),
      appliedRules: [],
    };
  }

  const resultIssues: ValidationIssue[] = [];
  const evidenceIssues: ValidationIssue[] = [];
  const appliedRules: Array<{ ruleId: string; issueCode: string; action: string }> = [];
  let suppressedCount = 0;
  let overriddenCount = 0;

  for (const issue of issues) {
    let suppressed = false;
    let transformed = issue;
    let severityOverridden = false;
    let messageOverridden = false;

    for (const rule of enabledRules) {
      if (!matchesRule(issue, rule.match)) continue;

      switch (rule.action) {
        case 'suppress':
          suppressed = true;
          suppressedCount++;
          transformed = appendAdvisorApplication(transformed, rule, {
            before: transformed.severity,
            after: 'suppressed',
          });
          appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: 'suppress' });
          break;

        case 'override-severity':
          if (!severityOverridden && rule.transform?.severity) {
            const before = transformed.severity;
            transformed = appendAdvisorApplication({
              ...withRawEvidence(transformed),
              severity: rule.transform.severity,
            }, rule, { before, after: rule.transform.severity });
            severityOverridden = true;
            overriddenCount++;
            appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: `severity:${issue.severity}->${rule.transform.severity}` });
          }
          break;

        case 'override-message':
          if (!messageOverridden && rule.transform?.message) {
            const before = transformed.message;
            transformed = appendAdvisorApplication({
              ...withRawEvidence(transformed),
              message: rule.transform.message,
            }, rule, { before, after: rule.transform.message });
            messageOverridden = true;
            overriddenCount++;
            appliedRules.push({ ruleId: rule.id, issueCode: issue.code || '', action: 'message-override' });
          }
          break;
      }

      if (suppressed) break;
    }

    const evidence = {
      ...withRawEvidence(transformed),
      disposition: suppressed ? 'suppressed' as const : 'active' as const,
    };
    evidenceIssues.push(evidence);
    if (!suppressed) resultIssues.push(transformed);
  }

  if (appliedRules.length > 0) {
    logger.debug(
      `[AdvisorRules] Applied ${appliedRules.length} rule(s): ` +
      `${suppressedCount} suppressed, ${overriddenCount} overridden`,
    );
  }

  return {
    originalIssues: issues.length,
    suppressedCount,
    overriddenCount,
    resultIssues,
    evidenceIssues,
    appliedRules,
  };
}

function withRawEvidence(issue: ValidationIssue): ValidationIssue {
  return {
    ...issue,
    rawSeverity: issue.rawSeverity ?? issue.severity,
    rawMessage: issue.rawMessage ?? issue.message,
    disposition: issue.disposition ?? 'active',
    advisoryApplications: [...(issue.advisoryApplications ?? [])],
  };
}

function appendAdvisorApplication(
  issue: ValidationIssue,
  rule: AdvisorRule,
  change: Pick<AdvisorRuleApplication, 'before' | 'after'>,
): ValidationIssue {
  const evidence = withRawEvidence(issue);
  return {
    ...evidence,
    advisoryApplications: [
      ...(evidence.advisoryApplications ?? []),
      {
        ruleId: rule.id,
        action: rule.action,
        priority: rule.priority ?? 0,
        ...(rule.reason ? { reason: rule.reason } : {}),
        ...change,
      },
    ],
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
