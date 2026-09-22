import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeChoiceTypePath } from './choice-type-path.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import type { AspectResult } from './multi-aspect-types.js';
import { isBestPracticeIssue, relabelProfileImposedIssue } from './profile-attribution-relabel.js';
import type { ElementDefinition, StructureDefinition } from './structure-definition-types.js';

/**
 * The applied profile counts as a declared substitution only when the resource
 * itself asked for it via meta.profile. Explicit run profiles that differ from
 * the declaration and code-inferred selections are attributed elsewhere.
 */
export function resolveDeclaredProfileSubstitution(
  resource: unknown,
  appliedProfileUrl: string,
): string | null {
  return getPrimaryDeclaredProfile(resource) === appliedProfileUrl ? appliedProfileUrl : null;
}

/**
 * Re-home constraint findings produced by validating against a declared
 * meta.profile SD. The silent base-SD substitution otherwise surfaces
 * profile-imposed minimums as "structural" claims that read as base-spec
 * statements. Only provably profile-tightened findings move — the snapshot's
 * ElementDefinition.base cardinality is the discriminator — so genuine
 * base-SD violations keep their structural label. No signpost is emitted:
 * the user declared the profile, so the selection needs no explanation.
 */
export function applyDeclaredProfileAttribution(
  issues: ValidationIssue[],
  profileUrl: string,
  structureDef: StructureDefinition,
): ValidationIssue[] {
  return relabelDeclaredProfileIssues(issues, profileUrl, buildElementIndex(structureDef));
}

/** Multi-aspect variant: relabels the collected aspect buckets in place. */
export function applyDeclaredProfileAttributionToAspectResults(
  collectedAspects: AspectResult[],
  profileUrl: string,
  structureDef: StructureDefinition,
): void {
  const elementIndex = buildElementIndex(structureDef);
  for (const result of collectedAspects) {
    result.issues = relabelDeclaredProfileIssues(result.issues, profileUrl, elementIndex);
    if (result.evidenceIssues) {
      result.evidenceIssues = relabelDeclaredProfileIssues(result.evidenceIssues, profileUrl, elementIndex);
    }
  }
}

type SnapshotElementIndex = Map<string, ElementDefinition>;

function relabelDeclaredProfileIssues(
  issues: ValidationIssue[],
  profileUrl: string,
  elementIndex: SnapshotElementIndex,
): ValidationIssue[] {
  return issues.map(issue => isDeclaredProfileImposedFinding(issue, profileUrl, elementIndex)
    ? relabelProfileImposedIssue(issue, profileUrl, {
      profileSource: 'declared',
      declaredProfileUrl: profileUrl,
    })
    : issue);
}

function isDeclaredProfileImposedFinding(
  issue: ValidationIssue,
  profileUrl: string,
  elementIndex: SnapshotElementIndex,
): boolean {
  if (issue.aspect !== 'structural' || issue.code !== 'structural-cardinality-min') return false;
  if (issue.profile !== undefined && issue.profile !== profileUrl) return false;
  if (isBestPracticeIssue(issue)) return false;
  if (hasSliceProvenance(issue)) return true;
  return isProfileTightenedMinimum(issue, elementIndex);
}

/** Slice minimums always stem from the profile's slicing definition. */
function hasSliceProvenance(issue: ValidationIssue): boolean {
  const structuredDetails = typeof issue.details === 'object' && issue.details !== null
    ? issue.details
    : undefined;
  return typeof structuredDetails?.sliceName === 'string'
    || typeof issue.target?.sliceName === 'string';
}

/**
 * A minimum is profile-imposed only when the snapshot element tightened the
 * inherited base cardinality. Unknown paths or missing base metadata stay
 * structural — under-attribution is safer than claiming base-spec findings.
 */
function isProfileTightenedMinimum(
  issue: ValidationIssue,
  elementIndex: SnapshotElementIndex,
): boolean {
  if (!issue.path) return false;
  const element = elementIndex.get(normalizeChoiceTypePath(issue.path));
  if (!element) return false;
  const baseMin = readBaseMin(element);
  return baseMin !== undefined && (element.min ?? 0) > baseMin;
}

function readBaseMin(element: ElementDefinition): number | undefined {
  const inheritedBase = element.base;
  if (typeof inheritedBase !== 'object' || inheritedBase === null) return undefined;
  const min = (inheritedBase as Record<string, unknown>).min;
  return typeof min === 'number' ? min : undefined;
}

function buildElementIndex(structureDef: StructureDefinition): SnapshotElementIndex {
  const elementIndex: SnapshotElementIndex = new Map();
  for (const element of structureDef.snapshot?.element ?? []) {
    // Slice entries repeat the path with slice-scoped cardinality; only the
    // defining (unsliced) element carries the base comparison that matters.
    if (element.sliceName) continue;
    const key = normalizeChoiceTypePath(element.path);
    if (!elementIndex.has(key)) elementIndex.set(key, element);
  }
  return elementIndex;
}
