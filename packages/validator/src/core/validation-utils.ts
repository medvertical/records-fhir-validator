/**
 * Validation Utilities
 * 
 * Shared utilities for validation operations.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */
/* eslint-disable max-lines */

import type { ValidationIssue } from '../types';
import { normalizeChoiceTypePath } from './choice-type-path';
import { resolveFhirSegmentValue } from './fhir-primitive-sidecar';

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
          const value = resolveFhirSegmentValue(item, part);
          if (value !== undefined) {
            nextValues.push(value);
          }
        }
      } else {
        const value = resolveFhirSegmentValue(current, part);

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

export { dedupeIssues } from './validation-issue-dedupe';

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
  const minCardinalityPaths = new Set<string>();
  for (const issue of issues) {
    if (issue.code === 'structural-type-mismatch' && issue.path) {
      typeMismatchPaths.add(normalizeChoiceTypePath(issue.path));
    }
    if (issue.code === 'structural-cardinality-min' && issue.path) {
      minCardinalityPaths.add(normalizeChoiceTypePath(issue.path));
    }
  }
  if (typeMismatchPaths.size === 0 && minCardinalityPaths.size === 0) return issues;

  return issues.filter(issue => {
    if (issue.code === 'binding-required-missing' && issue.path) {
      return !minCardinalityPaths.has(normalizeChoiceTypePath(issue.path));
    }
    if (
      issue.code !== 'terminology-binding-extensible-code' &&
      issue.code !== 'terminology-binding-preferred-code' &&
      issue.code !== 'terminology-binding-example-code'
    ) return true;
    if (!issue.path) return true;
    return !typeMismatchPaths.has(normalizeChoiceTypePath(issue.path));
  });
}
