import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { StructureDefinition } from '../core/structure-definition-types';
import {
  extractFixedValue,
  extractPatternValue,
  getValueAtPath,
  matchesPattern,
  valueMatchesFixedConstraint,
  valuesMatch,
} from './slice-utils';
import type { SliceDefinition } from './slice-types';

const CHOICE_BASES = [
  'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
  'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
  'product', 'serviced', 'location', 'allowed', 'used',
  'rate', 'born', 'age',
];

export function resourceTypeFromPath(path: string): string {
  const firstSegment = path.split('.')[0]?.replace(/\[[^\]]+\]/g, '');
  return firstSegment || 'Unknown';
}

export function validateSliceContentConstraints(
  element: any,
  slice: SliceDefinition,
  elementPath: string,
  profileSD: StructureDefinition
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];
  const slicePrefix = `${slice.path}:${slice.sliceName}`;

  for (const elementDef of elements) {
    const relativePath = getSliceRelativePath(elementDef, slicePrefix);
    if (relativePath === null || relativePath.includes(':')) continue;

    const fixedValue = extractFixedValue(elementDef);
    if (fixedValue !== undefined) {
      issues.push(...validateSliceFixedValue(element, slice, elementPath, relativePath, fixedValue));
    }

    const patternValue = extractPatternValue(elementDef);
    if (patternValue !== undefined) {
      issues.push(...validateSlicePatternValue(element, slice, elementPath, relativePath, patternValue));
    }
  }

  return issues;
}

export function validateSliceRootConstraints(
  element: any,
  slice: SliceDefinition,
  elementPath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (
    slice.fixed !== undefined &&
    !valueMatchesFixedConstraint(element, slice.fixed, slice.fixedKind)
  ) {
    const fieldIssues = validateRootFixedValueFields(element, slice, elementPath);
    if (fieldIssues.length > 0) {
      issues.push(...fieldIssues);
    } else {
      issues.push(createValidationIssue({
        code: 'profile-slice-fixed-value-mismatch',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slice '${slice.sliceName}' requires fixed value '${slice.fixed}', found: '${element}'`,
        details: {
          sliceName: slice.sliceName,
          relativePath: '$this',
          expectedValue: slice.fixed,
          actualValue: element,
        },
      }));
    }
  }

  if (
    slice.pattern !== undefined &&
    !matchesPattern(element, slice.pattern)
  ) {
    issues.push(createValidationIssue({
      code: 'profile-slice-pattern-mismatch',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      customMessage: `Slice '${slice.sliceName}' pattern mismatch`,
      details: {
        sliceName: slice.sliceName,
        relativePath: '$this',
        expectedPattern: slice.pattern,
        actualValue: element,
      },
    }));
  }

  return issues;
}

function validateRootFixedValueFields(
  actualValue: any,
  slice: SliceDefinition,
  elementPath: string,
): ValidationIssue[] {
  const fixedValue = slice.fixed;
  if (!isPlainObject(actualValue) || !isPlainObject(fixedValue)) return [];

  const issues: ValidationIssue[] = [];
  const fixedKeys = new Set(Object.keys(fixedValue));
  for (const key of Object.keys(actualValue)) {
    if (fixedKeys.has(key)) continue;
    issues.push(createRootFixedFieldIssue(
      slice,
      `${elementPath}.${key}`,
      key,
      undefined,
      actualValue[key],
      `The element ${key} is present in the instance but not allowed in the applicable fixed value specified in profile`,
    ));
  }

  for (const key of fixedKeys) {
    const expected = fixedValue[key];
    const actual = actualValue[key];
    if (valuesMatch(actual, expected)) continue;
    issues.push(createRootFixedFieldIssue(
      slice,
      `${elementPath}.${key}`,
      key,
      expected,
      actual,
      `Slice '${slice.sliceName}' requires '${key}' to match fixed value '${JSON.stringify(expected)}', found: '${JSON.stringify(actual)}'`,
    ));
  }

  return issues;
}

function createRootFixedFieldIssue(
  slice: SliceDefinition,
  path: string,
  relativePath: string,
  expectedValue: any,
  actualValue: any,
  customMessage: string,
): ValidationIssue {
  return createValidationIssue({
    code: 'profile-fixed-value-mismatch',
    path,
    resourceType: resourceTypeFromPath(path),
    customMessage,
    details: {
      sliceName: slice.sliceName,
      relativePath,
      expectedValue,
      actualValue,
    },
  });
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function emitMatchedSliceChildIssues(
  element: any,
  slice: SliceDefinition,
  elementPath: string,
  profileSD: StructureDefinition
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const snapshot = profileSD.snapshot?.element;
  if (!snapshot?.length) return issues;

  const idPrefix = `${slice.path}:${slice.sliceName}.`;

  for (const elementDef of snapshot) {
    const id = elementDef.id;
    if (!id || !id.startsWith(idPrefix)) continue;

    const relative = id.substring(idPrefix.length);
    if (relative.includes('.') || relative.includes(':')) continue;

    const isRequired = (elementDef.min ?? 0) >= 1;
    const isMustSupport = elementDef.mustSupport === true;
    if (!isRequired && !isMustSupport) continue;

    const actualValue = getValueAtPath(element, relative);
    const isPresent = actualValue !== undefined && actualValue !== null &&
      (!Array.isArray(actualValue) || actualValue.length > 0);
    if (isPresent) continue;
    if (isMustSupport && mustSupportMissingIsSatisfiedBySiblingValue(element, relative)) continue;

    const childPath = `${elementPath}:${slice.sliceName}.${relative}`;
    issues.push(createMissingSliceChildIssue(childPath, slice.sliceName, isRequired));
  }

  return issues;
}

function getSliceRelativePath(elementDef: any, slicePrefix: string): string | null {
  const id = elementDef.id;
  const path = elementDef.path;

  if (id && id.startsWith(`${slicePrefix}.`)) {
    return id.substring(slicePrefix.length + 1);
  }
  if (path.startsWith(`${slicePrefix}.`)) {
    return path.substring(slicePrefix.length + 1);
  }
  return null;
}

function validateSliceFixedValue(
  element: any,
  slice: SliceDefinition,
  elementPath: string,
  relativePath: string,
  fixedValue: any,
): ValidationIssue[] {
  const actualValue = getValueAtPath(element, relativePath);
  if (actualValue === undefined || actualValue === null) {
    return [createValidationIssue({
      code: 'profile-slice-fixed-value-missing',
      path: `${elementPath}.${relativePath}`,
      resourceType: resourceTypeFromPath(elementPath),
      customMessage: `Slice '${slice.sliceName}' requires fixed value '${JSON.stringify(fixedValue)}' at ${relativePath}`,
      details: {
        sliceName: slice.sliceName,
        relativePath,
        expectedValue: fixedValue,
        actualValue: null,
      },
    })];
  }

  if (valuesMatch(actualValue, fixedValue)) return [];

  return [createValidationIssue({
    code: 'profile-slice-fixed-value-mismatch',
    path: `${elementPath}.${relativePath}`,
    resourceType: resourceTypeFromPath(elementPath),
    customMessage: `Slice '${slice.sliceName}' requires '${relativePath}' to be '${fixedValue}', found: '${actualValue}'`,
    details: {
      sliceName: slice.sliceName,
      relativePath,
      expectedValue: fixedValue,
      actualValue,
    },
  })];
}

function validateSlicePatternValue(
  element: any,
  slice: SliceDefinition,
  elementPath: string,
  relativePath: string,
  patternValue: any,
): ValidationIssue[] {
  const actualValue = getValueAtPath(element, relativePath);
  if (actualValue === undefined || actualValue === null) return [];
  if (matchesPattern(actualValue, patternValue)) return [];

  return [createValidationIssue({
    code: 'profile-slice-pattern-mismatch',
    path: `${elementPath}.${relativePath}`,
    resourceType: resourceTypeFromPath(elementPath),
    customMessage: `Slice '${slice.sliceName}' pattern mismatch at ${relativePath}`,
    details: {
      sliceName: slice.sliceName,
      relativePath,
      expectedPattern: patternValue,
      actualValue,
    },
  })];
}

function createMissingSliceChildIssue(
  childPath: string,
  sliceName: string,
  isRequired: boolean,
): ValidationIssue {
  return createValidationIssue({
    code: isRequired ? 'required-element-missing' : 'profile-mustsupport-missing',
    path: childPath,
    resourceType: resourceTypeFromPath(childPath),
    messageParams: { element: childPath },
    details: { sliceName },
  });
}

function mustSupportMissingIsSatisfiedBySiblingValue(element: any, relativePath: string): boolean {
  return /^dataAbsentReason$/i.test(relativePath) && hasAnyChoiceValue(element);
}

function hasAnyChoiceValue(element: any): boolean {
  return CHOICE_BASES.some(base => hasChoiceValue(element, base));
}

function hasChoiceValue(element: any, base: string): boolean {
  if (!element || typeof element !== 'object') return false;
  if (element[base] !== undefined && element[base] !== null) return true;

  return Object.keys(element).some(key =>
    key.startsWith(base) &&
    key.length > base.length &&
    key[base.length] === key[base.length].toUpperCase() &&
    element[key] !== undefined &&
    element[key] !== null
  );
}
