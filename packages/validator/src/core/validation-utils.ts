/**
 * Validation Utilities
 * 
 * Shared utilities for validation operations.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '../types';

/**
 * Helper: Get value at FHIRPath-like path
 * Simplified path resolution (e.g., "Patient.name" -> resource.name)
 */
export function getValueAtPath(resource: any, path: string): any {
  const parts = path.split('.');

  if (parts[0] === resource.resourceType) {
    parts.shift();
  }

  let currentValues: any[] = [resource];

  for (const part of parts) {
    const nextValues: any[] = [];

    for (const current of currentValues) {
      if (current === undefined || current === null) {
        continue;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          if (item === undefined || item === null) {
            continue;
          }
          const value = item[part];
          if (value !== undefined) {
            nextValues.push(value);
          }
        }
      } else {
        let value = current[part];

        // Handle FHIR choice types (e.g. value[x] -> valueQuantity, valueString)
        if (value === undefined && part.endsWith('[x]')) {
          const prefix = part.slice(0, -3);
          const actualKey = Object.keys(current).find(k => k.startsWith(prefix));
          if (actualKey) {
            value = current[actualKey];
          }
        }

        if (value !== undefined) {
          nextValues.push(value);
        }
      }
    }

    if (nextValues.length === 0) {
      return undefined;
    }

    currentValues = nextValues.flatMap((value) =>
      Array.isArray(value) ? value : [value]
    );
  }

  if (currentValues.length === 0) {
    return undefined;
  }

  return currentValues.length === 1 ? currentValues[0] : currentValues;
}

/**
 * Create a validation error issue
 */
export function createValidationErrorIssue(
  aspect: ValidationIssue['aspect'],
  code: string,
  message: string,
  details?: Record<string, any>,
  path?: string
): ValidationIssue {
  return {
    id: `records-${code}-${Date.now()}`,
    aspect,
    severity: 'error',
    code,
    message,
    path: path || '',
    timestamp: new Date(),
    ...(details && { details })
  };
}

/**
 * Create a validation information issue (for system messages, not user errors)
 * Used for things like profile-not-found, which are system-level messages
 * rather than validation errors in the user's data
 */
export function createValidationInfoIssue(
  aspect: ValidationIssue['aspect'],
  code: string,
  message: string,
  details?: Record<string, any>,
  path?: string
): ValidationIssue {
  return {
    id: `records-${code}-${Date.now()}`,
    aspect,
    severity: 'info',
    code,
    message,
    path: path || '',
    timestamp: new Date(),
    ...(details && { details })
  };
}

/**
 * Dedupe issues by (code, path, severity, rule). Prevents reporting the same
 * constraint violation (e.g. dom-6) multiple times when several validators
 * independently re-check the same rule, while preserving distinct slice
 * cardinality failures that legitimately share one base path.
 */
export function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const specificBundleInvariantKeys = new Set<string>();
  for (const issue of issues) {
    if (issue.code === 'bdl-9-violation') specificBundleInvariantKeys.add('bdl-9');
    if (issue.code === 'bdl-10-violation') specificBundleInvariantKeys.add('bdl-10');
  }

  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    if (isRedundantBundleInvariantIssue(issue, specificBundleInvariantKeys)) {
      continue;
    }

    const details = issue.details;
    const detailRuleKey = details && typeof details === 'object' && !Array.isArray(details)
      ? [
        (details as Record<string, unknown>).constraintKey ?? (details as Record<string, unknown>).sliceName,
        (details as Record<string, unknown>).sourceProfile,
      ].filter(value => typeof value === 'string' && value.length > 0).join(':')
      : undefined;
    const ruleKey = [issue.ruleId, detailRuleKey]
      .filter(value => typeof value === 'string' && value.length > 0)
      .join(':');
    const key = `${issue.code}:${normalizeIssuePathForDedupe(issue)}:${issue.severity}:${ruleKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(issue);
    }
  }
  return out;
}

function isRedundantBundleInvariantIssue(issue: ValidationIssue, specificKeys: Set<string>): boolean {
  if (issue.code !== 'profile-constraint-violation' || specificKeys.size === 0) return false;

  const details = issue.details;
  const detailConstraint = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).constraintKey
    : undefined;
  const message = issue.message ?? '';

  const constraintKey = typeof detailConstraint === 'string'
    ? detailConstraint
    : message.includes("Constraint 'bdl-9'")
      ? 'bdl-9'
      : message.includes("Constraint 'bdl-10'")
        ? 'bdl-10'
        : undefined;

  return Boolean(constraintKey && specificKeys.has(constraintKey));
}

function normalizeIssuePathForDedupe(issue: ValidationIssue): string {
  const path = issue.path || '';
  const details = issue.details;
  const detailsResourceType = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).resourceType
    : undefined;
  const resourceType = typeof issue.resourceType === 'string'
    ? issue.resourceType
    : typeof detailsResourceType === 'string'
      ? detailsResourceType
      : undefined;

  if (!resourceType) return path;

  const prefix = `${resourceType}.`.toLowerCase();
  const lowerPath = path.toLowerCase();
  return lowerPath.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Suppress terminology binding warnings on paths where a structural
 * type-mismatch error already fires. When the element value is the wrong
 * FHIR type entirely (e.g. `valueString` where a profile requires
 * `valueQuantity`), the code-in-valueset check on that same path is
 * noise — the value isn't even parseable as the expected type. The
 * reference Java validator likewise emits just the type error, not the
 * binding warning on a broken value.
 *
 * Conservative: only suppresses extensible / preferred / example bindings
 * (i.e. non-required). A required binding that fires alongside a type
 * mismatch is still worth surfacing in case the user switches to the
 * correct type — the two errors describe independent problems.
 */
export function suppressRedundantBindingWarnings(
  issues: ValidationIssue[],
): ValidationIssue[] {
  const typeMismatchPaths = new Set<string>();
  for (const issue of issues) {
    if (issue.code === 'structural-type-mismatch' && issue.path) {
      typeMismatchPaths.add(normalizeChoiceTypePath(issue.path));
    }
  }
  if (typeMismatchPaths.size === 0) return issues;

  return issues.filter(issue => {
    if (
      issue.code !== 'terminology-binding-extensible-code' &&
      issue.code !== 'terminology-binding-preferred-code' &&
      issue.code !== 'terminology-binding-example-code'
    ) return true;
    if (!issue.path) return true;
    return !typeMismatchPaths.has(normalizeChoiceTypePath(issue.path));
  });
}

/**
 * Collapse concrete choice-type property names to the `[x]` form so
 * type-mismatch on `Observation.value[x]` and a binding issue on
 * `Observation.valueString` can still correlate. (Records emits the
 * `[x]` form for structural mismatches and the concrete form elsewhere.)
 */
function normalizeChoiceTypePath(path: string): string {
  return path
    .replace(/\[\d+\]/g, '')
    .replace(/\.(value|effective|onset|abatement|occurrence|timing|medication|component|product)[A-Z]\w*(?=\.|$)/g, '.$1[x]')
    .toLowerCase();
}
