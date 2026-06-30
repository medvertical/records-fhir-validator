import type { ValidationIssue } from '../types';
import { normalizeChoiceTypePath } from './choice-type-path';

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
  const profileSliceMinPaths = new Set<string>();
  const ref1InvariantPaths = new Set<string>();
  const invalidUriPaths = new Set<string>();
  const containedInvalidPaths = new Set<string>();
  const requiredBindingViolationPaths = new Set<string>();
  const extensionNoValuePaths = new Set<string>();
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
    if (issue.code === 'profile-slice-min-cardinality') {
      profileSliceMinPaths.add(normalizeRequiredElementPath(issue));
    }
    if (issue.code === 'ref-1-violation') {
      ref1InvariantPaths.add(normalizeRequiredElementPath(issue));
    }
    if (issue.code === 'structural-invalid-uri') {
      invalidUriPaths.add(normalizeRequiredElementPath(issue));
    }
    if (isContainedUnreferencedInvalidIssue(issue)) {
      containedInvalidPaths.add(normalizeRequiredElementPath(issue));
    }
    if (issue.code === 'profile-required-binding-violation') {
      requiredBindingViolationPaths.add(normalizeRequiredElementPath(issue));
    }
    if (issue.code === 'profile-extension-no-value') {
      extensionNoValuePaths.add(normalizeRequiredElementPath(issue));
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
    if (isRedundantProfileSliceCardinalityIssue(issue, profileSliceMinPaths)) {
      continue;
    }
    if (isRedundantReferenceFormatIssue(issue, ref1InvariantPaths)) {
      continue;
    }
    if (isRedundantTerminologyNotFoundIssue(issue, invalidUriPaths)) {
      continue;
    }
    if (isRedundantContainedUnreferencedIssue(issue, containedInvalidPaths)) {
      continue;
    }
    if (isRedundantPresenceInvariantIssue(issue, requiredBindingViolationPaths)) {
      continue;
    }
    if (isRedundantExtensionConstraintIssue(issue, extensionNoValuePaths)) {
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

function isRedundantProfileSliceCardinalityIssue(issue: ValidationIssue, profileSliceMinPaths: Set<string>): boolean {
  if (profileSliceMinPaths.size === 0) return false;
  if (issue.code !== 'structural-cardinality-min') return false;
  return profileSliceMinPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantReferenceFormatIssue(issue: ValidationIssue, ref1InvariantPaths: Set<string>): boolean {
  if (ref1InvariantPaths.size === 0) return false;
  if (issue.code !== 'reference-invalid-format') return false;
  return ref1InvariantPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantTerminologyNotFoundIssue(issue: ValidationIssue, invalidUriPaths: Set<string>): boolean {
  if (invalidUriPaths.size === 0) return false;
  if (issue.code !== 'not-found') return false;
  return invalidUriPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantContainedUnreferencedIssue(issue: ValidationIssue, containedInvalidPaths: Set<string>): boolean {
  if (containedInvalidPaths.size === 0) return false;
  if (issue.code !== 'contained-unreferenced') return false;
  return containedInvalidPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantPresenceInvariantIssue(issue: ValidationIssue, requiredBindingViolationPaths: Set<string>): boolean {
  if (requiredBindingViolationPaths.size === 0) return false;
  if (issue.code !== 'ait-1-violation') return false;
  return requiredBindingViolationPaths.has(normalizeRequiredElementPath(issue));
}

function isRedundantExtensionConstraintIssue(issue: ValidationIssue, extensionNoValuePaths: Set<string>): boolean {
  if (extensionNoValuePaths.size === 0) return false;
  if (issue.code !== 'profile-constraint-violation') return false;
  const details = issue.details;
  const constraintKey = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).constraintKey
    : undefined;
  if (constraintKey !== 'ext-1') return false;
  return extensionNoValuePaths.has(normalizeRequiredElementPath(issue));
}

function isContainedUnreferencedInvalidIssue(issue: ValidationIssue): boolean {
  if (issue.code !== 'invalid') return false;
  const message = issue.message?.toLowerCase() ?? '';
  if (!message.includes('contained resource') || !message.includes('not referenced')) {
    return false;
  }
  return normalizeRequiredElementPath(issue).includes('contained');
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

  return normalizeChoiceTypePath(path
    .replace(/\[\d+\]/g, '')
    .replace(/:[^.]+/g, '')
    .replace(/^[A-Z][A-Za-z0-9]*\./, ''));
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
  if (code?.endsWith('-violation')) {
    const key = code.slice(0, -'-violation'.length);
    return key.length > 0 ? key : null;
  }
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
 * Collapse concrete choice-type property names to the `[x]` form so
 * type-mismatch on `Observation.value[x]` and a binding issue on
 * `Observation.valueString` can still correlate. (Records emits the
 * `[x]` form for structural mismatches and the concrete form elsewhere.)
 */
