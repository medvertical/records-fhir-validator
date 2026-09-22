import type { ValidationIssue } from '@records-fhir/validation-types';
import type { Binding, ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { matchesPattern } from '../../validators/slice-utils.js';
import { UCUM_BEARING_TYPES } from './terminology-ucum-rules.js';
import { isResolvedPrimitiveSidecarValue } from '../fhir-primitive-sidecar.js';
import {
  codingMatchesPattern,
  codeableConceptMatchesPattern,
  elementMatchesOwnPattern,
  getPatternOrFixedValue,
} from './terminology-binding-pattern-matching.js';
import type { TerminologySlicePlanCache } from './terminology-slice-plan-cache.js';
export function effectiveBindingForElement(
  elementDef: Pick<ElementDefinition, 'binding' | 'type'>,
): Binding | undefined {
  const binding = elementDef.binding; // Quantity bindings are downgraded to HAPI-aligned extensible strength.
  if (binding?.strength !== 'required') return binding;
  const hasQuantityType = elementDef.type?.some(t => UCUM_BEARING_TYPES.has(t.code));
  return hasQuantityType ? { ...binding, strength: 'extensible' as const } : binding;
}

export function shouldValidateBindingForValue(
  elementDef: { path?: string; type?: { code: string }[] },
  value: unknown,
): boolean {
  if (isResolvedPrimitiveSidecarValue(value)) return false;
  if (!elementDef.path?.endsWith('[x]')) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;

  const candidate = value as Record<string, unknown>;
  const quantityLike = typeof candidate.value === 'number' &&
    typeof candidate.system === 'string' &&
    typeof candidate.code === 'string';

  return !quantityLike;
}

function getValueAtRelativePath(value: unknown, path: string): unknown {
  if (!path || path === '$this') return value;
  if (!value || typeof value !== 'object') return undefined;

  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    const object = current as Record<string, unknown>;
    if (part.includes('[x]')) {
      const choicePrefix = part.replace('[x]', '');
      current = Object.entries(object).find(([key]) =>
        key.startsWith(choicePrefix) &&
        key.length > choicePrefix.length &&
        key.charAt(choicePrefix.length) === key.charAt(choicePrefix.length).toUpperCase()
      )?.[1];
    } else {
      current = object[part];
    }
  }
  return current;
}

function elementMatchesSliceChildConstraints(
  value: unknown,
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  planCache: TerminologySlicePlanCache,
): boolean {
  const constraints = planCache.getSliceChildConstraints(structureDef, elementDef);
  if (constraints.length === 0) return false;

  return constraints.every(constraint => {
    const relativePath = constraint.id!.substring(`${elementDef.id}.`.length);
    return matchesPattern(getValueAtRelativePath(value, relativePath), getPatternOrFixedValue(constraint));
  });
}

function getRelativePathWithinSlice(elementDef: ElementDefinition, sliceElement: ElementDefinition): string {
  if (!elementDef.id || !sliceElement.id || elementDef.id === sliceElement.id) return '';
  return elementDef.id.substring(`${sliceElement.id}.`.length);
}

function elementMatchesSlice(
  value: unknown,
  sliceElement: ElementDefinition,
  structureDef: StructureDefinition,
  planCache: TerminologySlicePlanCache,
): boolean {
  const ownPatternOrFixed = getPatternOrFixedValue(sliceElement);
  if (ownPatternOrFixed !== undefined) return matchesPattern(value, ownPatternOrFixed);
  if (elementMatchesOwnPattern(sliceElement, value)) return true;

  const ownChildConstraints = planCache.getSliceChildConstraints(structureDef, sliceElement);
  if (ownChildConstraints.length > 0) {
    return elementMatchesSliceChildConstraints(value, sliceElement, structureDef, planCache);
  }

  const siblingPatterns = planCache.getSiblingSlicePatterns(structureDef, sliceElement);
  if (siblingPatterns.length > 0) {
    return !siblingPatterns.some(sibling => elementMatchesOwnPattern(sibling, value));
  }

  return false;
}

export function selectSliceScopedValues(
  resource: unknown,
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  getValueAtPath: (resource: unknown, path: string) => unknown,
  planCache: TerminologySlicePlanCache,
): { hasMatchingSliceElements: boolean; values: unknown[] } | null {
  const sliceElement = planCache.getOwningSliceElement(structureDef, elementDef);
  if (!sliceElement) return null;

  const sliceParentValue = getValueAtPath(resource, sliceElement.path);
  const sliceParentValues = Array.isArray(sliceParentValue)
    ? sliceParentValue
    : sliceParentValue !== null && sliceParentValue !== undefined
      ? [sliceParentValue]
      : [];

  if (
    (sliceElement.min ?? 0) > 0 &&
    planCache.isValueSetDiscriminatedSliceRoot(sliceElement, structureDef) &&
    getPatternOrFixedValue(sliceElement) === undefined &&
    planCache.getSliceChildConstraints(structureDef, sliceElement).length === 0
  ) {
    return {
      hasMatchingSliceElements: sliceParentValues.length > 0,
      values: sliceParentValues,
    };
  }

  const matchingSliceValues = sliceParentValues.filter(value =>
    elementMatchesSlice(value, sliceElement, structureDef, planCache),
  );

  const relativePath = getRelativePathWithinSlice(elementDef, sliceElement);
  if (!relativePath) {
    return { hasMatchingSliceElements: matchingSliceValues.length > 0, values: matchingSliceValues };
  }

  const values = matchingSliceValues
    .map(value => getValueAtRelativePath(value, relativePath))
    .filter(value => value !== null && value !== undefined)
    .flatMap(value => Array.isArray(value) ? value : [value]);

  return { hasMatchingSliceElements: matchingSliceValues.length > 0, values };
}

export function shouldSuppressValueSetSliceMembershipIssue(
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  issues: ValidationIssue[],
  planCache: TerminologySlicePlanCache,
): boolean {
  if (!planCache.isValueSetDiscriminatedSliceRoot(elementDef, structureDef)) return false;
  if (!hasBindingMembershipViolation(issues)) return false;

  return (elementDef.min ?? 0) === 0;
}

export function shouldSuppressNonRequiredBindingForOwnFixedPattern(
  elementDef: ElementDefinition,
  value: unknown,
): boolean {
  const strength = elementDef.binding?.strength;
  if (strength === 'required') return false;
  if (elementDef.sliceName || elementDef.id?.includes(':')) return false;
  return elementMatchesOwnPattern(elementDef, value);
}

function isBindingMembershipViolation(issue: ValidationIssue): boolean {
  return issue.code === 'terminology-binding-required' ||
    issue.code === 'terminology-binding-required-code' ||
    issue.code === 'terminology-binding-extensible' ||
    issue.code === 'terminology-binding-extensible-code' ||
    issue.code === 'terminology-binding-preferred' ||
    issue.code === 'terminology-binding-preferred-code';
}

function hasBindingMembershipViolation(issues: ValidationIssue[]): boolean {
  return issues.some(isBindingMembershipViolation);
}

/**
 * "Slicing by value sets": sibling slices are told apart by their required
 * bindings, so a repeat outside this slice's value set belongs to another
 * slice (or the open portion), not in error. For a min>0 slice the binding
 * failure only stands when no repeat satisfies the value set at all.
 */
export function applyValueSetSliceMembershipPolicy(
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  perCandidateIssues: ValidationIssue[][],
  planCache: TerminologySlicePlanCache,
): ValidationIssue[] {
  const combined = perCandidateIssues.flat();
  if (
    (elementDef.min ?? 0) === 0 ||
    !planCache.isValueSetDiscriminatedSliceRoot(elementDef, structureDef)
  ) {
    return combined;
  }
  const anyCandidateInValueSet = perCandidateIssues.some(
    issues => !hasBindingMembershipViolation(issues),
  );
  if (!anyCandidateInValueSet) return combined;
  return combined.filter(issue => !isBindingMembershipViolation(issue));
}

export function selectValuesForBinding(
  elementDef: ElementDefinition,
  value: unknown,
  structureDef: StructureDefinition,
  planCache: TerminologySlicePlanCache,
): unknown[] {
  const values = Array.isArray(value) ? value : [value];

  if (!elementDef.sliceName) {
    return values;
  }

  const ownPatternOrFixed = getPatternOrFixedValue(elementDef);
  if (ownPatternOrFixed !== undefined) {
    return values.filter(item => matchesPattern(item, ownPatternOrFixed));
  }

  const patternCoding = (elementDef as ElementDefinition & { patternCoding?: Record<string, unknown> }).patternCoding;
  if (patternCoding) {
    if (Array.isArray(value)) {
      return value.filter(item => codingMatchesPattern(item, patternCoding));
    }

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>).coding)
    ) {
      return ((value as Record<string, unknown>).coding as unknown[])
        .filter(item => codingMatchesPattern(item, patternCoding));
    }

    return codingMatchesPattern(value, patternCoding) ? [value] : [];
  }

  const patternCodeableConcept = (
    elementDef as ElementDefinition & { patternCodeableConcept?: Record<string, unknown> }
  ).patternCodeableConcept;
  if (patternCodeableConcept) {
    return values.filter(item => codeableConceptMatchesPattern(item, patternCodeableConcept));
  }

  const ownChildConstraints = planCache.getSliceChildConstraints(structureDef, elementDef);
  if (ownChildConstraints.length > 0) {
    return values.filter(item => elementMatchesSliceChildConstraints(item, elementDef, structureDef, planCache));
  }

  const siblingPatterns = planCache.getSiblingSlicePatterns(structureDef, elementDef);
  if (siblingPatterns.length > 0) {
    return values.filter(item => !siblingPatterns.some(sibling => elementMatchesOwnPattern(sibling, item)));
  }

  return values;
}
