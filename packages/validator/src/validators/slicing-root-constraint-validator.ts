import { createValidationIssue } from "../issues/index.js";
import type { ValidationIssue } from '@records-fhir/validation-types';
import { matchesPattern, valueMatchesFixedConstraint, valuesMatch } from "./slice-utils.js";
import type { SliceDefinition } from "./slice-types.js";
import { formatConstraintValue, resourceTypeFromPath } from "./slicing-content-format.js";

export function validateSliceRootConstraints(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (slice.fixed !== undefined && !valueMatchesFixedConstraint(element, slice.fixed, slice.fixedKind)) {
    const fieldIssues = validateRootFixedValueFields(element, slice, elementPath);
    if (fieldIssues.length > 0) {
      issues.push(...fieldIssues);
    } else {
      issues.push(
        createValidationIssue({
          code: "profile-slice-fixed-value-mismatch",
          path: elementPath,
          resourceType: resourceTypeFromPath(elementPath),
          customMessage: `Slice '${slice.sliceName}' requires fixed value '${slice.fixed}', found: '${element}'`,
          details: {
            sliceName: slice.sliceName,
            relativePath: "$this",
            expectedValue: slice.fixed,
            actualValue: element,
          },
        }),
      );
    }
  }

  if (slice.pattern !== undefined && !matchesPattern(element, slice.pattern)) {
    issues.push(
      createValidationIssue({
        code: "profile-slice-pattern-mismatch",
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slice '${slice.sliceName}' pattern mismatch`,
        details: {
          sliceName: slice.sliceName,
          relativePath: "$this",
          expectedPattern: slice.pattern,
          actualValue: element,
        },
      }),
    );
  }

  return issues;
}

function validateRootFixedValueFields(
  actualValue: unknown,
  slice: SliceDefinition,
  elementPath: string,
): ValidationIssue[] {
  const fixedValue = slice.fixed;
  if (!isPlainObject(actualValue) || !isPlainObject(fixedValue)) return [];

  const issues: ValidationIssue[] = [];
  const fixedKeys = new Set(Object.keys(fixedValue));
  for (const key of Object.keys(actualValue)) {
    if (fixedKeys.has(key)) continue;
    issues.push(
      createRootFixedFieldIssue(
        slice,
        `${elementPath}.${key}`,
        key,
        undefined,
        actualValue[key],
        `The element ${key} is present in the instance but not allowed in the applicable fixed value specified in profile`,
      ),
    );
  }

  for (const key of fixedKeys) {
    const expected = fixedValue[key];
    const actual = actualValue[key];
    if (valuesMatch(actual, expected)) continue;
    issues.push(
      createRootFixedFieldIssue(
        slice,
        `${elementPath}.${key}`,
        key,
        expected,
        actual,
        `Slice '${slice.sliceName}' requires '${key}' to match fixed value '${formatConstraintValue(expected)}', found: '${formatConstraintValue(actual)}'`,
      ),
    );
  }

  return issues;
}

function createRootFixedFieldIssue(
  slice: SliceDefinition,
  path: string,
  relativePath: string,
  expectedValue: unknown,
  actualValue: unknown,
  customMessage: string,
): ValidationIssue {
  return createValidationIssue({
    code: "profile-fixed-value-mismatch",
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
