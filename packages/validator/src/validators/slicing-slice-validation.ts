import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { getAncestorPaths } from '../business-rules/element-path-resolver.js';
import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';
import { getProfileElements, getSlicingDefinition, isSliceInScope } from './slice-info-input.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ConstraintValidator } from './constraint-validator.js';
import {
  emitMatchedSliceChildIssues,
  resourceTypeFromPath,
  validateSliceContentConstraints,
  validateSliceRootConstraints,
} from './slicing-content-rules.js';
import type { SliceElementMatch } from './slicing-match-assignment.js';
import { shouldSuppressUnresolvedBindingOnlyMin } from './slicing-match-policy.js';
import { usesDirectExistsDiscrimination } from './slice-discriminator-constraints.js';
import { usesResolvedCodeDiscrimination } from './slice-resolved-code-discriminator.js';
import type { SliceDefinition } from './slice-types.js';
import { validateSliceTypeProfileConstraints } from './slicing-type-profile-constraints.js';
import type { ProfileConformanceCheck } from './sd-fhirpath-profile-conformance.js';

interface ValidateMatchedSlicesOptions {
  elements: unknown[];
  elementPath: string;
  /** The sliced element's path in the profile; slice element ids build on it. */
  definitionPath?: string;
  selectedSlicingElementId?: string;
  profile: StructureDefinition;
  slices: SliceDefinition[];
  unresolvedSliceNames: ReadonlySet<string>;
  sliceMatches: ReadonlyMap<string, SliceElementMatch[]>;
  cardinalityMatches: ReadonlyMap<string, SliceElementMatch[]>;
  possibleCardinalityMatches?: ReadonlyMap<string, SliceElementMatch[]>;
  hasUnresolvedReferenceDiscriminator: boolean;
  hasDirectProfileConformanceEvidence?: boolean;
  mustSupportSeverity: 'warning' | 'information';
  fhirVersion: FhirVersionFamily;
  typeProfileResolver: ((profileUrl: string) => Promise<StructureDefinition | null>) | null;
  typeProfileConstraintValidator: ConstraintValidator;
  rootResource?: unknown;
  profileConformance?: ProfileConformanceCheck;
}

export async function validateMatchedSlices(
  options: ValidateMatchedSlicesOptions,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const slice of options.slices) {
    if (options.unresolvedSliceNames.has(slice.sliceName)) {
      // Missing code/exists metadata still leaves a finite occurrence bound; generic
      // unknowns need the selected definition and complete local source group.
      if (options.elements.length === 0 || slice.resolvedCodeDiscriminators?.size
        || usesDirectExistsDiscrimination(slice.discriminator ?? [])
        || (options.elements.length < slice.min && hasValidSnapshotMinimum(slice, options)
          && hasAttestedUnconditionalGroup(options))) {
        const count = options.cardinalityMatches.get(slice.sliceName)?.length ?? 0;
        appendSliceCardinalityIssues(issues, slice, count, options);
      }
      continue;
    }
    const matchedElements = options.sliceMatches.get(slice.sliceName) || [];
    const count = options.cardinalityMatches.get(slice.sliceName)?.length ?? 0;
    appendSliceCardinalityIssues(issues, slice, count, options);

    for (const matched of matchedElements) {
      const matchedPath = matchedElementPath(options.elementPath, slice.sliceName, matched.index);
      issues.push(...validateSliceRootConstraints(matched.element, slice, matchedPath));
      issues.push(...validateSliceContentConstraints(matched.element, slice, matchedPath, options.profile));
      issues.push(...emitMatchedSliceChildIssues(
        matched.element,
        slice,
        matchedPath,
        options.profile,
        options.mustSupportSeverity,
      ));
      issues.push(...await validateSliceTypeProfileConstraints(
        matched.element,
        slice,
        matchedPath,
        options.fhirVersion,
        options.typeProfileResolver,
        options.typeProfileConstraintValidator,
        options.rootResource,
        options.profileConformance,
        true,
      ));
    }
  }
  return issues;
}

/**
 * A type slice of a choice element (`value[x]:valueQuantity`) matches the
 * single property its name spells, not an item of `value[x]`.
 */
function matchedElementPath(elementPath: string, sliceName: string, index: number): string {
  const lastDot = elementPath.lastIndexOf('.');
  const stem = elementPath.endsWith('[x]') ? elementPath.slice(lastDot + 1, -'[x]'.length) : undefined;
  if (stem && sliceName.startsWith(stem) && /^[A-Z]/.test(sliceName.slice(stem.length))) {
    return `${elementPath.slice(0, lastDot + 1)}${sliceName}`;
  }
  return `${elementPath}[${index}]`;
}

function appendSliceCardinalityIssues(
  issues: ValidationIssue[],
  slice: SliceDefinition,
  count: number,
  options: ValidateMatchedSlicesOptions,
): void {
  const resourceType = resourceTypeFromPath(options.elementPath);
  const possible = options.possibleCardinalityMatches?.get(slice.sliceName)?.length ?? 0;
  const directBound = options.hasDirectProfileConformanceEvidence === true
    && hasAttestedUnconditionalGroup(options) && hasValidSnapshotMinimum(slice, options);
  const profile = options.profile.version ? `${options.profile.url}|${options.profile.version}` : options.profile.url;
  if (
    count + possible < slice.min
    && (!options.hasUnresolvedReferenceDiscriminator
      || usesResolvedCodeDiscrimination(slice.discriminator ?? []) || directBound)
    && !shouldSuppressUnresolvedBindingOnlyMin(slice, options.elements)
  ) {
    if (directBound && possible > 0) issues.push(finiteSliceMinimumIssue(slice, options, count + possible));
    else issues.push(createValidationIssue({
      code: 'profile-slice-min-cardinality',
      profile,
      path: options.elementPath,
      resourceType,
      messageParams: { slice: slice.sliceName, min: slice.min, actual: count },
      ruleId: `slice-min-${slice.sliceName}`,
      details: { sliceName: slice.sliceName },
      target: {
        path: options.elementPath,
        elementId: `${options.definitionPath ?? options.elementPath}:${slice.sliceName}`,
        sliceName: slice.sliceName,
      },
    }));
  } else if (options.elements.length < slice.min && hasValidSnapshotMinimum(slice, options)
    && hasAttestedUnconditionalGroup(options)) {
    issues.push(finiteSliceMinimumIssue(slice, options));
  }

  if (slice.max === '*') return;
  const max = Number.parseInt(slice.max, 10);
  if (count <= max) return;
  issues.push(createValidationIssue({
    code: 'profile-slice-max-cardinality',
    profile,
    path: options.elementPath,
    resourceType,
    messageParams: { slice: slice.sliceName, max: slice.max, actual: count },
    ruleId: `slice-max-${slice.sliceName}`,
    details: { sliceName: slice.sliceName },
  }));
}


type FiniteMinimumOptions = Pick<ValidateMatchedSlicesOptions,
  'elements' | 'slices' | 'profile' | 'definitionPath' | 'elementPath' | 'selectedSlicingElementId' | 'rootResource'>;

/** Incomplete identity cannot defeat a minimum with a complete, applicable local group. */
export function buildFiniteSliceMinimumIssues(options: FiniteMinimumOptions): ValidationIssue[] {
  if (!hasAttestedUnconditionalGroup(options)) return [];
  return options.slices.filter(slice => options.elements.length < slice.min && hasValidSnapshotMinimum(slice, options))
    .map(slice => finiteSliceMinimumIssue(slice, options));
}


function hasValidSnapshotMinimum(slice: SliceDefinition, options: FiniteMinimumOptions): boolean {
  const element = getProfileElements({ ...options.profile, differential: undefined }).find(candidate =>
    candidate.id === `${options.selectedSlicingElementId}:${slice.sliceName}`
    && candidate.path === options.definitionPath && candidate.sliceName === slice.sliceName);
  const minimum = element?.min;
  // ElementDefinition.min is unsignedInt; malformed metadata cannot prove a bound.
  return typeof minimum === 'number' && Number.isInteger(minimum)
    && minimum >= 0 && minimum <= 2147483647 && minimum === slice.min;
}

export function hasAttestedUnconditionalGroup(options: FiniteMinimumOptions): boolean {
  const path = options.definitionPath;
  if (!path || path.includes(':') || options.selectedSlicingElementId !== path
    || !Array.isArray(options.profile.snapshot?.element)) return false;
  // Differential fallback does not attest a complete snapshot scope.
  const metadata = getProfileElements({ ...options.profile, differential: undefined });
  const samePath = metadata.filter(element => element.path === path);
  // A bare ID cannot restore ancestor identity discarded by a caller. Other
  // scoped declarations at this path keep that selection opaque.
  return new Set(samePath.map(element => element.id)).size === samePath.length
    && samePath.filter(element => getSlicingDefinition(element)).length === 1
    && samePath.some(element => element.id === path && getSlicingDefinition(element))
    && samePath.every(element => element.id === path || isSliceInScope(element, path))
    && getAncestorPaths(path).every(ancestorPath => {
      const ancestors = metadata.filter(element => element.path === ancestorPath);
      return ancestors.length === 1 && ancestors[0].id === ancestorPath
        && !ancestors[0].sliceName && !getSlicingDefinition(ancestors[0]);
    })
    && hasCompleteLocalSourceGroup(options);
}


function hasCompleteLocalSourceGroup(options: FiniteMinimumOptions): boolean {
  const source = options.rootResource;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const rootType = 'resourceType' in source ? source.resourceType : undefined;
  if (rootType !== options.profile.type || rootType !== options.definitionPath?.split('.')[0]
    || options.elementPath.replace(/\[\d+\]/g, '') !== options.definitionPath) return false;
  const parts = options.elementPath.split('.');
  const leaf = parts.pop();
  if (!leaf || /\[\d+\]/.test(leaf)) return false;
  const parentPath = parts.join('.');
  const parents = getValidationTargets(source, parentPath).filter(target => target.value != null);
  // An unindexed/flattened parent projection cannot attest one local group.
  if (parents.length !== 1 || parents[0].fullPath !== parentPath) return false;
  const actual = resolveFhirSegmentValue(parents[0].value, leaf);
  const occurrences = actual == null ? [] : Array.isArray(actual) ? actual : [actual];
  return occurrences.length === options.elements.length
    && occurrences.every((value, index) => value === options.elements[index]);
}

function finiteSliceMinimumIssue(
  slice: SliceDefinition, options: FiniteMinimumOptions, upperBound = options.elements.length,
): ValidationIssue {
  return createValidationIssue({
    code: 'profile-slice-min-cardinality',
    profile: options.profile.version ? `${options.profile.url}|${options.profile.version}` : options.profile.url,
    path: options.elementPath,
    resourceType: resourceTypeFromPath(options.elementPath),
    ruleId: `slice-min-${slice.sliceName}`,
    customMessage: `Slice '${slice.sliceName}' requires at least ${slice.min} occurrences, `
      + `but no more than ${upperBound} present occurrences can belong to it.`,
    details: { sliceName: slice.sliceName, cardinalityUpperBound: upperBound, occurrenceCount: options.elements.length },
    target: {
      path: options.elementPath,
      elementId: `${options.definitionPath}:${slice.sliceName}`,
      sliceName: slice.sliceName,
    },
  });
}
