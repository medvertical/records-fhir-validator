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
  const specificConstraintKeys = new Set<string>();
  const cardinalityMinPaths = new Set<string>();
  const profileExtensionMinPaths = new Set<string>();
  const hasGermanGenderExtensionMissing = issues.some(isGermanGenderExtensionMissingIssue);
  for (const issue of issues) {
    if (issue.code === 'bdl-9-violation') specificBundleInvariantKeys.add('bdl-9');
    if (issue.code === 'bdl-10-violation') specificBundleInvariantKeys.add('bdl-10');
    const constraintKey = getSpecificConstraintKey(issue);
    if (constraintKey) {
      for (const key of getConstraintDedupeKeys(issue, constraintKey)) {
        specificConstraintKeys.add(key);
      }
    }
    if (issue.code === 'structural-cardinality-min') {
      cardinalityMinPaths.add(normalizeRequiredElementPath(issue));
    }
    if (issue.code === 'profile-extension-min-cardinality') {
      profileExtensionMinPaths.add(normalizeRequiredElementPath(issue));
    }
  }

  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    if (isRedundantBundleInvariantIssue(issue, specificBundleInvariantKeys)) {
      continue;
    }
    if (isRedundantGenericConstraintIssue(issue, specificConstraintKeys)) {
      continue;
    }
    if (hasGermanGenderExtensionMissing && isMiiGenderConstraintIssue(issue)) {
      continue;
    }
    if (isRedundantRequiredElementIssue(issue, cardinalityMinPaths)) {
      continue;
    }
    if (isRedundantProfileExtensionCardinalityIssue(issue, profileExtensionMinPaths)) {
      continue;
    }

    const details = issue.details;
    const detailRuleKey = details && typeof details === 'object' && !Array.isArray(details)
      ? [
        (details as Record<string, unknown>).constraintKey ?? (details as Record<string, unknown>).sliceName,
        (details as Record<string, unknown>).sourceProfile,
      ].filter(value => typeof value === 'string' && value.length > 0).join(':')
      : undefined;
    const ruleKey = [getEffectiveRuleId(issue), detailRuleKey]
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

function isRedundantProfileExtensionCardinalityIssue(issue: ValidationIssue, profileExtensionMinPaths: Set<string>): boolean {
  if (profileExtensionMinPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  return profileExtensionMinPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantRequiredElementIssue(issue: ValidationIssue, cardinalityMinPaths: Set<string>): boolean {
  if (cardinalityMinPaths.size === 0) return false;
  if (issue.code !== 'structural-required-element-missing' && issue.code !== 'profile-mustsupport-missing') {
    return false;
  }
  return cardinalityMinPaths.has(normalizeRequiredElementPath(issue));
}

function normalizeRequiredElementPath(issue: ValidationIssue): string {
  const details = issue.details;
  const detailPath = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).fieldPath ?? (details as Record<string, unknown>).element
    : undefined;
  const path = typeof detailPath === 'string' && detailPath.length > 0
    ? detailPath
    : issue.path ?? '';

  return path
    .replace(/\[\d+\]/g, '')
    .replace(/:[^.]+/g, '')
    .replace(/^[A-Z][A-Za-z0-9]*\./, '')
    .toLowerCase();
}

function isGermanGenderExtensionMissingIssue(issue: ValidationIssue): boolean {
  if (issue.code !== 'profile-extension-missing') return false;
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  return (details as Record<string, unknown>).expectedExtension === 'http://fhir.de/StructureDefinition/gender-amtlich-de';
}

function isMiiGenderConstraintIssue(issue: ValidationIssue): boolean {
  if (issue.code === 'constraint-violation-mii-pat-1') return true;
  if (issue.code !== 'profile-constraint-violation') return false;
  const details = issue.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  return (details as Record<string, unknown>).constraintKey === 'mii-pat-1';
}

function getSpecificConstraintKey(issue: ValidationIssue): string | null {
  const prefix = 'constraint-violation-';
  if (issue.code?.startsWith(prefix)) {
    const key = issue.code.slice(prefix.length).trim().toLowerCase();
    return key.length > 0 ? key : null;
  }

  if (
    issue.code === 'profile-constraint-violation' ||
    issue.code === 'profile-constraint-warning'
  ) {
    return null;
  }

  const explicitRule = issue.ruleId?.trim().toLowerCase();
  if (explicitRule) return explicitRule;

  const code = issue.code?.trim().toLowerCase();
  return code && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(code) ? code : null;
}

function getEffectiveRuleId(issue: ValidationIssue): string | null {
  const explicitRule = issue.ruleId?.trim();
  if (explicitRule) return explicitRule;
  return getSpecificConstraintKey(issue);
}

function isRedundantGenericConstraintIssue(issue: ValidationIssue, specificKeys: Set<string>): boolean {
  if (
    issue.code !== 'profile-constraint-violation' &&
    issue.code !== 'profile-constraint-warning'
  ) return false;
  if (specificKeys.size === 0) return false;

  const details = issue.details;
  const constraintKey = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).constraintKey
    : undefined;
  if (typeof constraintKey !== 'string' || constraintKey.length === 0) return false;

  return getConstraintDedupeKeys(issue, constraintKey).some(key => specificKeys.has(key));
}

function isRedundantBundleInvariantIssue(issue: ValidationIssue, specificKeys: Set<string>): boolean {
  if (
    issue.code !== 'profile-constraint-violation' &&
    issue.code !== 'profile-constraint-warning'
  ) return false;
  if (specificKeys.size === 0) return false;

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

  if (!resourceType) return normalizeChoiceTypePath(path, { stripIndices: false });

  const prefix = `${resourceType}.`.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerPath === resourceType.toLowerCase()) return '';
  const relativePath = lowerPath.startsWith(prefix) ? path.slice(prefix.length) : path;
  return normalizeChoiceTypePath(relativePath, { stripIndices: false });
}

function getConstraintDedupeKeys(issue: ValidationIssue, constraintKey: string): string[] {
  return getConstraintPathHierarchy(normalizeIssuePathForDedupe(issue))
    .map(path => `${path}:${constraintKey.toLowerCase()}`);
}

function getConstraintPathHierarchy(path: string): string[] {
  const normalized = path
    .trim()
    .toLowerCase()
    .replace(/\[\d+\]/g, '')
    .replace(/\.$/, '');
  const paths = [normalized];

  let current = normalized;
  while (current.includes('.')) {
    current = current.slice(0, current.lastIndexOf('.')).replace(/\.$/, '');
    paths.push(current);
    if (isBundleEntryResourceRoot(current)) {
      return paths;
    }
  }

  if (!isBundleEntryResourcePath(normalized) && !paths.includes('')) {
    paths.push('');
  }

  return paths;
}

function isBundleEntryResourcePath(path: string): boolean {
  return path.startsWith('entry.resource/*');
}

function isBundleEntryResourceRoot(path: string): boolean {
  return isBundleEntryResourcePath(path) && path.endsWith('*/');
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
function normalizeChoiceTypePath(
  path: string,
  options: { stripIndices?: boolean } = {},
): string {
  const normalizedPath = options.stripIndices === false
    ? path
    : path.replace(/\[\d+\]/g, '');

  return normalizedPath
    .split('.')
    .map(normalizeChoiceTypeSegment)
    .join('.')
    .toLowerCase();
}

const CHOICE_TYPE_BASES = [
  'value',
  'effective',
  'onset',
  'abatement',
  'occurrence',
  'timing',
  'medication',
  'component',
  'product',
  'performed',
  'deceased',
  'asneeded',
  'multiplebirth',
  'serviced',
  'manufactured',
  'administered',
  'allowed',
  'defaultvalue',
  'fixed',
  'pattern',
] as const;

const CHOICE_TYPE_SUFFIXES = new Set([
  'base64binary',
  'boolean',
  'canonical',
  'code',
  'date',
  'datetime',
  'decimal',
  'id',
  'instant',
  'integer',
  'markdown',
  'oid',
  'positiveint',
  'string',
  'time',
  'unsignedint',
  'uri',
  'url',
  'uuid',
  'address',
  'age',
  'annotation',
  'attachment',
  'codeableconcept',
  'coding',
  'contactpoint',
  'count',
  'distance',
  'duration',
  'humanname',
  'identifier',
  'money',
  'period',
  'quantity',
  'range',
  'ratio',
  'reference',
  'sampleddata',
  'signature',
  'timing',
  'contactdetail',
  'contributor',
  'datarequirement',
  'expression',
  'parameterdefinition',
  'relatedartifact',
  'triggerdefinition',
  'usagecontext',
]);

function normalizeChoiceTypeSegment(segment: string): string {
  const lowerSegment = segment.toLowerCase();
  if (lowerSegment.endsWith('[x]')) return lowerSegment;

  for (const base of CHOICE_TYPE_BASES) {
    if (!lowerSegment.startsWith(base) || lowerSegment.length === base.length) {
      continue;
    }

    const suffix = lowerSegment.slice(base.length);
    if (CHOICE_TYPE_SUFFIXES.has(suffix)) {
      return `${base}[x]`;
    }
  }

  return lowerSegment;
}
