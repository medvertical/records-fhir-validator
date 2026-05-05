/**
 * Strictness Severity Utility
 * 
 * Controls validation issue severity based on strictness level and per-aspect settings.
 * 
 * This follows the HAPI FHIR pattern of severity modification rather than filtering:
 * - strict: All severities unchanged (most comprehensive)
 * - standard: All severities unchanged (default, balanced)
 * - compatibility: Downgrades severity for better interoperability
 *   - error → warning
 *   - warning → info
 * 
 * Additionally, per-aspect severity settings can cap the maximum severity for that aspect.
 */

import type { ValidationIssue, ValidationSeverity } from '@records-fhir/validation-types/validation-types';
import type { ValidationSettings, ValidationAspectConfig } from '@records-fhir/validation-types';
import { logger } from '../logger';

export type ValidationStrictness = 'compatibility' | 'standard' | 'strict';

/**
 * Resolve the strictness level and per-aspect severity-cap lookup from
 * a settings object. Centralises the cast-and-default dance so both the
 * single-aspect engine (`validation-engine-per-aspect`) and the
 * multi-aspect records-validator callback converge on the same logic.
 */
export function resolveStrictnessConfig(settings: ValidationSettings | undefined | null): {
  strictness: ValidationStrictness;
  aspectSeverityFor: (aspect: string) => ValidationSeverity | undefined;
} {
  const strictness =
    ((settings as (ValidationSettings & { validationStrictness?: ValidationStrictness }) | null | undefined)
      ?.validationStrictness) || 'standard';
  const aspects = settings?.aspects as unknown as Record<string, ValidationAspectConfig | undefined> | undefined;
  const aspectSeverityFor = (aspect: string): ValidationSeverity | undefined => {
    const sev = aspects?.[aspect]?.severity;
    return sev && sev !== 'inherit' ? sev : undefined;
  };
  return { strictness, aspectSeverityFor };
}

// Severity order for comparison (lower number = more severe)
const SEVERITY_ORDER: Record<string, number> = {
  inherit: 0, // treat inherit as most severe (no change)
  fatal: 1,
  error: 2,
  warning: 3,
  information: 4,
  info: 4, // alias for information
};

/**
 * Apply strictness-based severity adjustment to validation issues.
 * 
 * Instead of filtering issues out, this function DOWNGRADES severity:
 * - strict: no change (all severities as-is)
 * - standard: no change (default behavior)
 * - compatibility: error → warning, warning → info
 * 
 * @param issues - Array of validation issues to adjust
 * @param strictness - Global validation strictness level
 * @param aspectMaxSeverity - Optional per-aspect maximum severity cap
 * @returns Array of validation issues with adjusted severities
 */
export function applyStrictnessSeverity(
  issues: ValidationIssue[],
  strictness: ValidationStrictness,
  aspectMaxSeverity?: ValidationSeverity
): ValidationIssue[] {
  // Log for debugging
  if (aspectMaxSeverity && aspectMaxSeverity !== 'inherit') {
    logger.info(`[StrictnessSeverity] Applying aspect severity cap: ${aspectMaxSeverity} (strictness: ${strictness}, issues: ${issues.length})`);
  }

  return issues.map(issue => {
    let newSeverity: ValidationSeverity = issue.severity;

    // Skip 'inherit' severity - don't modify
    if (issue.severity === 'inherit') {
      return issue;
    }

    // 1. Apply strictness-based downgrade
    if (strictness === 'compatibility') {
      newSeverity = downgradeSeverity(newSeverity);

      // Log significant downgrades
      if (issue.severity === 'error' && newSeverity === 'warning') {
        logger.debug(`[StrictnessSeverity] Downgraded error→warning: ${issue.code || issue.message?.substring(0, 50)}`);
      }
    }
    // strict and standard: no change

    // 2. Apply per-aspect severity cap (if not 'inherit' and valid)
    if (aspectMaxSeverity && aspectMaxSeverity !== 'inherit') {
      const beforeCap = newSeverity;
      newSeverity = capSeverity(newSeverity, aspectMaxSeverity);
      if (beforeCap !== newSeverity) {
        logger.debug(`[StrictnessSeverity] Capped ${beforeCap}→${newSeverity} (max: ${aspectMaxSeverity}): ${issue.code || issue.message?.substring(0, 50)}`);
      }
    }

    // Return issue with adjusted severity (or original if unchanged)
    if (newSeverity !== issue.severity) {
      const originalDetails = typeof issue.details === 'object' ? issue.details : {};
      return {
        ...issue,
        severity: newSeverity,
        // Store original severity for reference
        details: {
          ...originalDetails,
          originalSeverity: issue.severity,
        }
      };
    }
    return issue;
  });
}

/**
 * Downgrade severity by one level.
 * error → warning, warning → info, info → info
 */
function downgradeSeverity(severity: ValidationSeverity): ValidationSeverity {
  switch (severity) {
    case 'fatal':
      return 'error';
    case 'error':
      return 'warning';
    case 'warning':
      return 'info';
    case 'info':
    case 'information':
    case 'inherit':
    default:
      return severity;
  }
}

/**
 * Cap severity to a maximum level.
 * If current severity is more severe than max, return max.
 */
function capSeverity(current: ValidationSeverity, max: ValidationSeverity): ValidationSeverity {
  // Don't cap 'inherit'
  if (current === 'inherit' || max === 'inherit') {
    return current;
  }

  const currentOrder = SEVERITY_ORDER[current] ?? 5;
  const maxOrder = SEVERITY_ORDER[max] ?? 5;

  // If current is more severe (lower number) than max, return max
  if (currentOrder < maxOrder) {
    return max;
  }
  return current;
}

/**
 * Get a human-readable description of the strictness level
 */
export function getStrictnessDescription(strictness: ValidationStrictness): string {
  switch (strictness) {
    case 'compatibility':
      return 'Lenient validation - errors shown as warnings for better interoperability';
    case 'standard':
      return 'Balanced validation with strict FHIR conformance (recommended)';
    case 'strict':
      return 'Comprehensive validation with all rules enforced at original severity';
    default:
      return 'Unknown strictness level';
  }
}

/**
 * Count issues by severity before and after strictness adjustment.
 * Useful for UI to show the impact of strictness settings.
 */
export function countSeveritiesWithStrictness(
  issues: ValidationIssue[],
  strictness: ValidationStrictness,
  aspectMaxSeverity?: ValidationSeverity
): {
  before: Record<string, number>;
  after: Record<string, number>;
  downgrades: number;
} {
  const before: Record<string, number> = { error: 0, warning: 0, info: 0 };
  const after: Record<string, number> = { error: 0, warning: 0, info: 0 };
  let downgrades = 0;

  const adjustedIssues = applyStrictnessSeverity(issues, strictness, aspectMaxSeverity);

  issues.forEach(issue => {
    const sev = issue.severity;
    if (sev !== 'inherit') {
      before[sev] = (before[sev] || 0) + 1;
    }
  });

  adjustedIssues.forEach((issue, i) => {
    const sev = issue.severity;
    if (sev !== 'inherit') {
      after[sev] = (after[sev] || 0) + 1;
    }
    if (issue.severity !== issues[i].severity) {
      downgrades++;
    }
  });

  return { before, after, downgrades };
}

/**
 * Get the effective severity for an issue after applying all adjustments.
 */
export function getEffectiveSeverity(
  originalSeverity: ValidationSeverity,
  strictness: ValidationStrictness,
  aspectMaxSeverity?: ValidationSeverity
): ValidationSeverity {
  let severity: ValidationSeverity = originalSeverity;

  // Don't modify 'inherit'
  if (severity === 'inherit') {
    return severity;
  }

  // Apply strictness downgrade
  if (strictness === 'compatibility') {
    severity = downgradeSeverity(severity);
  }

  // Apply aspect cap
  if (aspectMaxSeverity && aspectMaxSeverity !== 'inherit') {
    severity = capSeverity(severity, aspectMaxSeverity);
  }

  return severity;
}
