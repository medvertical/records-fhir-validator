/**
 * For-Publication Severity Escalation (gap C-C4)
 *
 * FHIR's IG Publisher validates in a stricter "for-publication" mode: a
 * published Implementation Guide should not ship with outstanding warnings, and
 * best-practice hints should be surfaced rather than buried at info level.
 *
 * This is a monotonic severity-ESCALATION layer — the inverse of the strictness
 * downgrade. It runs LAST, after `applyStrictnessSeverity` + `applyAdvisorRules`,
 * so explicit user decisions (advisor suppressions/overrides) still win:
 * escalation only raises whatever survives, and never downgrades, so it composes
 * cleanly with the layers before it.
 *
 * Default policy (forPublication = true):
 *   - warning            → error    (a published IG must be warning-free)
 *   - best-practice info → warning  (surface hints without erroring on every info)
 *   - error / fatal / other info: unchanged
 */

import type {
  ValidationIssue,
  ValidationSeverity,
} from '@records-fhir/validation-types';

/**
 * Read the opt-in `forPublication` flag off a settings object. Accepts any
 * shape carrying the flag (full `ValidationSettings` or a snapshot subset).
 */
export function isForPublication(settings: unknown): boolean {
  return Boolean((settings as { forPublication?: boolean } | null | undefined)?.forPublication);
}

function isBestPracticeIssue(issue: ValidationIssue): boolean {
  return typeof issue.code === 'string' && issue.code.startsWith('best-practice');
}

function escalatedSeverity(issue: ValidationIssue): ValidationSeverity | undefined {
  switch (issue.severity) {
    case 'warning':
      return 'error';
    case 'info':
    case 'information':
      return isBestPracticeIssue(issue) ? 'warning' : undefined;
    default:
      // error, fatal, inherit — already publication-blocking or untouchable
      return undefined;
  }
}

/**
 * Escalate issue severities for publication. No-op unless `forPublication` is
 * true. Preserves the earliest-known `originalSeverity` and marks escalated
 * issues with `details.publicationEscalated` for downstream/UI attribution.
 */
export function applyPublicationEscalation(
  issues: ValidationIssue[],
  forPublication: boolean,
): ValidationIssue[] {
  if (!forPublication) return issues;

  return issues.map(issue => {
    const next = escalatedSeverity(issue);
    if (!next || next === issue.severity) return issue;

    const originalDetails = (typeof issue.details === 'object' && issue.details) || {};
    const priorOriginal = (originalDetails as { originalSeverity?: ValidationSeverity }).originalSeverity;
    return {
      ...issue,
      severity: next,
      details: {
        ...originalDetails,
        originalSeverity: priorOriginal ?? issue.severity,
        publicationEscalated: true,
      },
    };
  });
}
