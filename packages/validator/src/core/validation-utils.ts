/**
 * Validation Utilities
 * 
 * Shared utilities for validation operations.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeChoiceTypePath } from './choice-type-path.js';
import { getPrimitiveSidecar, resolveFhirSegmentValue } from './fhir-primitive-sidecar.js';

/**
 * Helper: Get value at FHIRPath-like path
 * Simplified path resolution (e.g., "Patient.name" -> resource.name)
 */
export function getValueAtPath(resource: unknown, path: string): unknown {
  const parts = path.split('.');

  if (isObjectRecord(resource) && parts[0] === resource.resourceType) {
    parts.shift();
  }

  let currentValues: unknown[] = [resource];

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const hasRemainingPath = partIndex < parts.length - 1;
    const nextValues: unknown[] = [];

    for (const current of currentValues) {
      if (current === undefined || current === null) {
        continue;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          if (item === undefined || item === null) {
            continue;
          }
          const value = resolveSegmentForPath(item, part, hasRemainingPath);
          if (value !== undefined) {
            nextValues.push(value);
          }
        }
      } else {
        const value = resolveSegmentForPath(current, part, hasRemainingPath);

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

function resolveSegmentForPath(container: unknown, segment: string, hasRemainingPath: boolean): unknown {
  if (
    hasRemainingPath &&
    isObjectRecord(container) &&
    isPrimitiveValueOrPrimitiveArray(container[segment])
  ) {
    const sidecar = getPrimitiveSidecar(container, segment);
    if (sidecar !== undefined) return sidecar;
  }

  return resolveFhirSegmentValue(container, segment);
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null ||
    ['string', 'number', 'boolean'].includes(typeof value);
}

function isPrimitiveValueOrPrimitiveArray(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every(isPrimitiveValue)
    : isPrimitiveValue(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export {
  createValidationErrorIssue,
  createValidationInfoIssue,
  createValidationWarningIssue,
} from './core-validation-issue.js';

export {
  dedupeExactIssues,
  dedupeIssues,
  dedupeIssuesWithTrace,
  dedupeResourceTreeIssues,
  type DedupeIssuesResult,
  type DedupeSuppressionTrace,
} from './validation-issue-dedupe.js';

/**
 * Suppress terminology binding warnings on paths where a structural
 * type-mismatch error already fires. When the element value is the wrong
 * FHIR type entirely (e.g. `valueString` where a profile requires
 * `valueQuantity`), the code-in-valueset check on that same path is
 * noise — the value isn't even parseable as the expected type. The
 * reference Java validator likewise emits just the type error, not the
 * binding warning on a broken value. A system-inference error on that
 * same value is also a consequence of interpreting the wrong type as a code.
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
  const missingRequiredElementPaths = new Set<string>();
  const invalidCodeBindingParentPaths = new Set<string>();
  for (const issue of issues) {
    if (issue.code === 'structural-type-mismatch' && issue.path) {
      typeMismatchPaths.add(normalizeChoiceTypePath(issue.path, { stripIndices: false }));
    }
    if (isRequiredElementPresenceIssue(issue) && issue.path) {
      missingRequiredElementPaths.add(normalizeChoiceTypePath(issue.path));
    }
    if (issue.code === 'terminology-code-invalid' && issue.path) {
      const bindingParentPath = parentBindingPathForInvalidCode(issue.path);
      if (bindingParentPath) invalidCodeBindingParentPaths.add(bindingParentPath);
    }
  }
  if (
    typeMismatchPaths.size === 0 &&
    missingRequiredElementPaths.size === 0 &&
    invalidCodeBindingParentPaths.size === 0
  ) return issues;

  return issues.filter(issue => {
    if (
      (issue.code === 'binding-required-missing' || issue.code === 'terminology-binding-missing') &&
      issue.path
    ) {
      return !missingRequiredElementPaths.has(normalizeChoiceTypePath(issue.path));
    }
    if (issue.code === 'terminology-system-undetermined' && issue.path) {
      return !typeMismatchPaths.has(normalizeChoiceTypePath(issue.path, { stripIndices: false }));
    }
    if (!isNonRequiredBindingIssue(issue)) return true;
    if (!issue.path) return true;
    const normalizedPath = normalizeChoiceTypePath(issue.path);
    if (invalidCodeBindingParentPaths.has(normalizedPath)) return false;
    return !typeMismatchPaths.has(normalizeChoiceTypePath(issue.path, { stripIndices: false }));
  });
}

function isRequiredElementPresenceIssue(issue: ValidationIssue): boolean {
  return issue.code === 'structural-cardinality-min' ||
    issue.code === 'questionnaire-missing-status' ||
    issue.code === 'qr-missing-status';
}

function isNonRequiredBindingIssue(issue: ValidationIssue): boolean {
  return issue.code === 'terminology-binding-extensible' ||
    issue.code === 'terminology-binding-extensible-code' ||
    issue.code === 'terminology-binding-preferred' ||
    issue.code === 'terminology-binding-preferred-code' ||
    issue.code === 'terminology-binding-example' ||
    issue.code === 'terminology-binding-example-code';
}

function parentBindingPathForInvalidCode(path: string): string | null {
  const codeableConceptParent = path.replace(/\.coding\[\d+\]\.code$/i, '');
  if (codeableConceptParent !== path) {
    return normalizeChoiceTypePath(codeableConceptParent);
  }

  const codeableConceptParentBySystem = path.replace(/\.coding\[\d+\]\.system$/i, '');
  if (codeableConceptParentBySystem !== path) {
    return normalizeChoiceTypePath(codeableConceptParentBySystem);
  }

  const codingParent = path.replace(/\.code$/i, '');
  if (codingParent !== path) {
    return normalizeChoiceTypePath(codingParent);
  }

  const codingParentBySystem = path.replace(/\.system$/i, '');
  if (codingParentBySystem !== path) {
    return normalizeChoiceTypePath(codingParentBySystem);
  }

  return null;
}

const REMOTE_BUDGET_AGGREGATION_THRESHOLD = 5;
const REMOTE_BUDGET_SAMPLE_LIMIT = 5;

export function aggregateRemoteCodeSystemBudgetIssues(
  issues: ValidationIssue[],
): ValidationIssue[] {
  const groups = new Map<string, ValidationIssue[]>();
  const groupedIssues = new Set<ValidationIssue>();

  for (const issue of issues) {
    if (!isRemoteBudgetCodeSystemIssue(issue)) continue;
    const system = remoteBudgetIssueSystem(issue);
    const reason = remoteBudgetIssueReason(issue);
    if (!system || !reason) continue;
    const key = `${system}\u0000${reason}`;
    const group = groups.get(key) ?? [];
    group.push(issue);
    groups.set(key, group);
    groupedIssues.add(issue);
  }

  if (!Array.from(groups.values()).some(group => group.length > REMOTE_BUDGET_AGGREGATION_THRESHOLD)) {
    return issues;
  }

  const emittedGroups = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    if (!groupedIssues.has(issue)) {
      out.push(issue);
      continue;
    }

    const system = remoteBudgetIssueSystem(issue);
    const reason = remoteBudgetIssueReason(issue);
    const key = system && reason ? `${system}\u0000${reason}` : '';
    const group = key ? groups.get(key) : undefined;
    if (!group || group.length <= REMOTE_BUDGET_AGGREGATION_THRESHOLD) {
      out.push(issue);
      continue;
    }
    if (emittedGroups.has(key)) continue;

    emittedGroups.add(key);
    out.push(buildRemoteBudgetAggregateIssue(issue, group, system!, reason!));
  }

  return out;
}

function isRemoteBudgetCodeSystemIssue(issue: ValidationIssue): boolean {
  return issue.aspect === 'terminology' &&
    issue.code === 'terminology-codesystem-unverified' &&
    issue.severity !== 'error' &&
    remoteBudgetIssueReason(issue) === 'remote-budget-exhausted';
}

function remoteBudgetIssueSystem(issue: ValidationIssue): string | null {
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const system = (details as Record<string, unknown>).system;
  return typeof system === 'string' && system.length > 0 ? system : null;
}

function remoteBudgetIssueReason(issue: ValidationIssue): string | null {
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const reason = (details as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

function remoteBudgetIssueCode(issue: ValidationIssue): string | null {
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const code = (details as Record<string, unknown>).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

function buildRemoteBudgetAggregateIssue(
  representative: ValidationIssue,
  group: ValidationIssue[],
  system: string,
  reason: string,
): ValidationIssue {
  const representativeDetails =
    representative.details && typeof representative.details === 'object' && !Array.isArray(representative.details)
      ? withoutRemoteBudgetSingleCodeDetails(representative.details)
      : {};
  const sampleCodes = uniqueStrings(group.map(remoteBudgetIssueCode)).slice(0, REMOTE_BUDGET_SAMPLE_LIMIT);
  const samplePaths = uniqueStrings(group.map(issue => issue.path ?? '')).slice(0, REMOTE_BUDGET_SAMPLE_LIMIT);
  const codeSample = sampleCodes.length > 0 ? ` (examples: ${sampleCodes.join(', ')})` : '';

  return {
    ...representative,
    id: `${representative.id}-aggregate`,
    message:
      `Remote CodeSystem validation budget was exhausted; ${group.length} codes from ${system} ` +
      `were not verified against the terminology server${codeSample}`,
    path: samplePaths[0] ?? representative.path,
    details: {
      ...representativeDetails,
      system,
      reason,
      count: group.length,
      sampleCodes,
      samplePaths,
      fixHint:
        'Increase maxRemoteCodeSystemValidations for deeper remote terminology evidence, or provide a local CodeSystem package/cache.',
    },
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function withoutRemoteBudgetSingleCodeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const { code: _code, display: _display, ...aggregateDetails } = details;
  return aggregateDetails;
}
