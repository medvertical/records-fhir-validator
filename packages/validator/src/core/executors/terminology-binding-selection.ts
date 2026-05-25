import type { ValidationIssue } from '../../types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import { matchesPattern } from '../../validators/slice-utils';
import { UCUM_BEARING_TYPES } from './terminology-ucum-rules';

/** Quantity unit bindings: required -> extensible. HAPI-aligned; avoids false positives on derived profiles. */
export function effectiveBindingForElement(elementDef: { binding?: any; type?: { code: string }[] }): any {
  const binding = elementDef.binding;
  if (binding?.strength !== 'required') return binding;
  const hasQuantityType = elementDef.type?.some(t => UCUM_BEARING_TYPES.has(t.code));
  return hasQuantityType ? { ...binding, strength: 'extensible' } : binding;
}

export function shouldValidateBindingForValue(
  elementDef: { path?: string; type?: { code: string }[] },
  value: unknown,
): boolean {
  if (!elementDef.path?.endsWith('[x]')) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;

  const candidate = value as Record<string, unknown>;
  const quantityLike = typeof candidate.value === 'number' &&
    typeof candidate.system === 'string' &&
    typeof candidate.code === 'string';

  return !quantityLike;
}

function codingMatchesPattern(coding: unknown, pattern: Record<string, unknown>): boolean {
  if (!coding || typeof coding !== 'object' || Array.isArray(coding)) return false;
  const candidate = coding as Record<string, unknown>;
  return Object.entries(pattern).every(([key, value]) => candidate[key] === value);
}

function codeableConceptMatchesPattern(value: unknown, pattern: Record<string, unknown>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  return Object.entries(pattern).every(([key, expected]) => {
    if (key === 'coding' && Array.isArray(expected)) {
      const candidateCodings = Array.isArray(candidate.coding) ? candidate.coding : [];
      return expected.every(patternCoding =>
        candidateCodings.some(candidateCoding =>
          codingMatchesPattern(candidateCoding, patternCoding as Record<string, unknown>),
        ),
      );
    }

    return candidate[key] === expected;
  });
}

function elementMatchesOwnPattern(elementDef: ElementDefinition, value: unknown): boolean {
  const patternOrFixed = getPatternOrFixedValue(elementDef);
  if (patternOrFixed !== undefined) return matchesPattern(value, patternOrFixed);

  const patternCoding = (elementDef as ElementDefinition & { patternCoding?: Record<string, unknown> }).patternCoding;
  if (patternCoding) return codingMatchesPattern(value, patternCoding);

  const patternCodeableConcept = (
    elementDef as ElementDefinition & { patternCodeableConcept?: Record<string, unknown> }
  ).patternCodeableConcept;
  if (patternCodeableConcept) return codeableConceptMatchesPattern(value, patternCodeableConcept);

  return false;
}

function getPatternOrFixedValue(elementDef: ElementDefinition): unknown {
  const candidate = elementDef as ElementDefinition & Record<string, unknown>;
  if (candidate.pattern !== undefined) return candidate.pattern;
  if (candidate.fixed !== undefined) return candidate.fixed;
  for (const key of Object.keys(candidate)) {
    if ((key.startsWith('pattern') || key.startsWith('fixed')) && key !== 'pattern' && key !== 'fixed') {
      return candidate[key];
    }
  }
  return undefined;
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

function getSliceChildConstraints(structureDef: StructureDefinition, elementDef: ElementDefinition): ElementDefinition[] {
  if (!elementDef.id || !elementDef.sliceName) return [];
  const prefix = `${elementDef.id}.`;
  return structureDef.snapshot?.element.filter(candidate =>
    typeof candidate.id === 'string' &&
    candidate.id.startsWith(prefix) &&
    getPatternOrFixedValue(candidate) !== undefined,
  ) ?? [];
}

function elementMatchesSliceChildConstraints(
  value: unknown,
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
): boolean {
  const constraints = getSliceChildConstraints(structureDef, elementDef);
  if (constraints.length === 0) return false;

  return constraints.every(constraint => {
    const relativePath = constraint.id!.substring(`${elementDef.id}.`.length);
    return matchesPattern(getValueAtRelativePath(value, relativePath), getPatternOrFixedValue(constraint));
  });
}

function getOwningSliceElement(
  structureDef: StructureDefinition,
  elementDef: ElementDefinition,
): ElementDefinition | null {
  if (!elementDef.id || !elementDef.id.includes(':')) return null;
  if (elementDef.sliceName) return elementDef;

  const sliceRootEnd = elementDef.id.indexOf('.', elementDef.id.indexOf(':'));
  if (sliceRootEnd === -1) return null;

  const sliceRootId = elementDef.id.slice(0, sliceRootEnd);
  return structureDef.snapshot?.element.find(candidate =>
    candidate.id === sliceRootId && Boolean(candidate.sliceName),
  ) ?? null;
}

function getRelativePathWithinSlice(elementDef: ElementDefinition, sliceElement: ElementDefinition): string {
  if (!elementDef.id || !sliceElement.id || elementDef.id === sliceElement.id) return '';
  return elementDef.id.substring(`${sliceElement.id}.`.length);
}

function elementMatchesSlice(
  value: unknown,
  sliceElement: ElementDefinition,
  structureDef: StructureDefinition,
): boolean {
  const ownPatternOrFixed = getPatternOrFixedValue(sliceElement);
  if (ownPatternOrFixed !== undefined) return matchesPattern(value, ownPatternOrFixed);
  if (elementMatchesOwnPattern(sliceElement, value)) return true;

  const ownChildConstraints = getSliceChildConstraints(structureDef, sliceElement);
  if (ownChildConstraints.length > 0) {
    return elementMatchesSliceChildConstraints(value, sliceElement, structureDef);
  }

  const siblingPatterns = getSiblingSlicePatterns(structureDef, sliceElement);
  if (siblingPatterns.length > 0) {
    return !siblingPatterns.some(sibling => elementMatchesOwnPattern(sibling, value));
  }

  return false;
}

export function selectSliceScopedValues(
  resource: unknown,
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  getValueAtPath: (resource: any, path: string) => any,
): { hasMatchingSliceElements: boolean; values: unknown[] } | null {
  const sliceElement = getOwningSliceElement(structureDef, elementDef);
  if (!sliceElement) return null;

  const sliceParentValue = getValueAtPath(resource, sliceElement.path);
  const sliceParentValues = Array.isArray(sliceParentValue)
    ? sliceParentValue
    : sliceParentValue !== null && sliceParentValue !== undefined
      ? [sliceParentValue]
      : [];

  if (
    (sliceElement.min ?? 0) > 0 &&
    isValueSetDiscriminatedSliceRoot(sliceElement, structureDef) &&
    getPatternOrFixedValue(sliceElement) === undefined &&
    getSliceChildConstraints(structureDef, sliceElement).length === 0
  ) {
    return {
      hasMatchingSliceElements: sliceParentValues.length > 0,
      values: sliceParentValues,
    };
  }

  const matchingSliceValues = sliceParentValues.filter(value =>
    elementMatchesSlice(value, sliceElement, structureDef),
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

function isSliceRootElement(elementDef: ElementDefinition): boolean {
  return Boolean(elementDef.sliceName && elementDef.id?.includes(':'));
}

function isValueSetDiscriminatedSliceRoot(
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
): boolean {
  if (!isSliceRootElement(elementDef) || !elementDef.binding?.valueSet) return false;

  const siblingSlices = structureDef.snapshot?.element.filter(candidate =>
    candidate !== elementDef &&
    candidate.path === elementDef.path &&
    Boolean(candidate.sliceName) &&
    Boolean(candidate.binding?.valueSet),
  ) ?? [];

  return siblingSlices.length > 0;
}

export function shouldSuppressValueSetSliceMembershipIssue(
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
  issues: ValidationIssue[],
): boolean {
  if (!isValueSetDiscriminatedSliceRoot(elementDef, structureDef)) return false;
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

function hasBindingMembershipViolation(issues: ValidationIssue[]): boolean {
  return issues.some(issue =>
    issue.code === 'terminology-binding-required' ||
    issue.code === 'terminology-binding-required-code' ||
    issue.code === 'terminology-binding-extensible' ||
    issue.code === 'terminology-binding-extensible-code' ||
    issue.code === 'terminology-binding-preferred' ||
    issue.code === 'terminology-binding-preferred-code'
  );
}

function getSiblingSlicePatterns(structureDef: StructureDefinition, elementDef: ElementDefinition): ElementDefinition[] {
  const elementId = elementDef.id;
  if (!elementId || !elementDef.sliceName) return [];

  const slicePrefix = elementId.slice(0, elementId.lastIndexOf(':') + 1);
  return structureDef.snapshot?.element.filter(candidate =>
    candidate.id !== elementId &&
    candidate.id?.startsWith(slicePrefix) &&
    candidate.path === elementDef.path &&
    Boolean(
      (candidate as ElementDefinition & { patternCoding?: unknown }).patternCoding ||
      (candidate as ElementDefinition & { patternCodeableConcept?: unknown }).patternCodeableConcept
    ),
  ) ?? [];
}

export function selectValuesForBinding(
  elementDef: ElementDefinition,
  value: unknown,
  structureDef: StructureDefinition,
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

  const ownChildConstraints = getSliceChildConstraints(structureDef, elementDef);
  if (ownChildConstraints.length > 0) {
    return values.filter(item => elementMatchesSliceChildConstraints(item, elementDef, structureDef));
  }

  const siblingPatterns = getSiblingSlicePatterns(structureDef, elementDef);
  if (siblingPatterns.length > 0) {
    return values.filter(item => !siblingPatterns.some(sibling => elementMatchesOwnPattern(sibling, item)));
  }

  return values;
}
