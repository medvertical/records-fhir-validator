import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from "../issues/index.js";
import type { ElementDefinition, StructureDefinition } from "../core/structure-definition-types.js";
import {
  extractFixedValue,
  extractPatternValue,
  getValueAtPath,
  matchesPattern,
  valuesMatch,
} from "./slice-utils.js";
import type { SliceDefinition } from "./slice-types.js";
import { isConcreteChoiceProperty, splitConcreteChoiceProperty } from "../core/fhir-choice-property.js";
import { getChildCardinalities, resolveValueOccurrences } from "./slicing-content-paths.js";
import { formatConstraintValue, resourceTypeFromPath } from "./slicing-content-format.js";

export { resourceTypeFromPath } from "./slicing-content-format.js";
export { validateSliceRootConstraints } from "./slicing-root-constraint-validator.js";

export function validateSliceContentConstraints(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  profileSD: StructureDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];
  const slicePrefix = `${slice.path}:${slice.sliceName}`;
  const checkedFixedPaths = new Set<string>();
  const checkedPatternPaths = new Set<string>();
  const requiredPaths = new Map(slice.childMin ?? []);

  for (const elementDef of elements) {
    const relativePath = getSliceRelativePath(elementDef, slicePrefix);
    if (relativePath === null || relativePath.includes(":")) continue;

    const fixedValue = extractFixedValue(elementDef);
    if (fixedValue !== undefined) {
      checkedFixedPaths.add(relativePath);
      issues.push(...validateSliceFixedValue(element, slice, elementPath, relativePath, fixedValue));
    }

    const patternValue = extractPatternValue(elementDef);
    if (patternValue !== undefined) {
      checkedPatternPaths.add(relativePath);
      issues.push(...validateSlicePatternValue(element, slice, elementPath, relativePath, patternValue));
    }

    const minimum = elementDef.min ?? 0;
    if (minimum > 0) {
      requiredPaths.set(relativePath, Math.max(requiredPaths.get(relativePath) ?? 0, minimum));
    }
  }

  for (const [relativePath, fixedValue] of slice.childFixed ?? []) {
    if (checkedFixedPaths.has(relativePath)) continue;
    if (!isContentConstraintPath(relativePath)) continue;
    issues.push(...validateSliceFixedValue(element, slice, elementPath, relativePath, fixedValue));
  }

  for (const [relativePath, minimum] of requiredPaths) {
    if (!isContentConstraintPath(relativePath)) continue;
    issues.push(...validateMinimumPerParent(element, slice, elementPath, relativePath, minimum));
  }

  for (const [relativePath, patternValue] of slice.childPatterns ?? []) {
    if (checkedPatternPaths.has(relativePath)) continue;
    if (!isContentConstraintPath(relativePath)) continue;
    issues.push(...validateSlicePatternValue(element, slice, elementPath, relativePath, patternValue));
  }

  return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function emitMatchedSliceChildIssues(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  profileSD: StructureDefinition,
  mustSupportSeverity: "warning" | "information" = "warning",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const snapshot = profileSD.snapshot?.element;
  if (!snapshot?.length) return issues;

  const idPrefix = `${slice.path}:${slice.sliceName}.`;

  for (const elementDef of snapshot) {
    const id = elementDef.id;
    if (!id || !id.startsWith(idPrefix)) continue;

    const relative = id.substring(idPrefix.length);
    if (relative.includes(".") || relative.includes(":")) continue;

    const isRequired = (elementDef.min ?? 0) >= 1;
    const isMustSupport = elementDef.mustSupport === true;
    if (!isRequired && !isMustSupport) continue;

    const actualValue = getValueAtPath(element, relative);
    const isPresent = actualValue !== undefined && actualValue !== null && (!Array.isArray(actualValue) || actualValue.length > 0);
    if (isPresent) continue;
    if (isMustSupport && mustSupportMissingIsSatisfiedBySiblingValue(element, relative)) continue;

    const childPath = `${elementPath}:${slice.sliceName}.${relative}`;
    issues.push(createMissingSliceChildIssue(childPath, slice.sliceName, isRequired, profileSD.url, mustSupportSeverity));
  }

  return issues;
}

function getSliceRelativePath(elementDef: ElementDefinition, slicePrefix: string): string | null {
  const id = elementDef.id;
  const path = elementDef.path;

  if (typeof id === "string" && id.startsWith(`${slicePrefix}.`)) {
    return id.substring(slicePrefix.length + 1);
  }
  if (typeof path === "string" && path.startsWith(`${slicePrefix}.`)) {
    return path.substring(slicePrefix.length + 1);
  }
  return null;
}

function validateSliceFixedValue(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  relativePath: string,
  fixedValue: unknown,
): ValidationIssue[] {
  return resolveValueOccurrences(element, relativePath)
    .filter((occurrence) => !valuesMatch(occurrence.value, fixedValue))
    .map((occurrence) =>
      createValidationIssue({
        code: "profile-slice-fixed-value-mismatch",
        path: appendRelativePath(elementPath, occurrence.path),
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slice '${slice.sliceName}' requires '${relativePath}' to be '${formatConstraintValue(fixedValue)}', found: '${formatConstraintValue(occurrence.value)}'`,
        details: {
          sliceName: slice.sliceName,
          relativePath,
          expectedValue: fixedValue,
          actualValue: occurrence.value,
        },
      }),
    );
}

function isContentConstraintPath(relativePath: string): boolean {
  // Constraints merged from a profiled slice type can include nested slice labels
  // such as "extension:domain.url". getValueAtPath resolves instance object
  // paths, not StructureDefinition slice labels, so emitting those as runtime
  // fixed/pattern mismatches creates false positives on valid nested slices.
  return !relativePath.split(".").some((segment) => segment.includes(":"));
}

function validateSlicePatternValue(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  relativePath: string,
  patternValue: unknown,
): ValidationIssue[] {
  return resolveValueOccurrences(element, relativePath)
    .filter((occurrence) => !matchesPattern(occurrence.value, patternValue))
    .map((occurrence) =>
      createValidationIssue({
        code: "profile-slice-pattern-mismatch",
        path: appendRelativePath(elementPath, occurrence.path),
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slice '${slice.sliceName}' pattern mismatch at ${relativePath}`,
        details: {
          sliceName: slice.sliceName,
          relativePath,
          expectedPattern: patternValue,
          actualValue: occurrence.value,
        },
      }),
    );
}

function createMissingSliceChildIssue(
  childPath: string,
  sliceName: string,
  isRequired: boolean,
  profileUrl?: string,
  mustSupportSeverity: "warning" | "information" = "warning",
): ValidationIssue {
  return createValidationIssue({
    code: isRequired ? "required-element-missing" : "profile-mustsupport-missing",
    path: childPath,
    resourceType: resourceTypeFromPath(childPath),
    profile: profileUrl,
    messageParams: { element: childPath },
    details: { sliceName },
    severityOverride: isRequired ? undefined : mustSupportSeverity,
  });
}

function mustSupportMissingIsSatisfiedBySiblingValue(element: unknown, relativePath: string): boolean {
  return /^dataAbsentReason$/i.test(relativePath) && hasAnyChoiceValue(element);
}

function hasAnyChoiceValue(element: unknown): boolean {
  return (
    hasChoiceValue(element, "value") ||
    (isPlainObject(element) &&
      Object.keys(element).some((key) => splitConcreteChoiceProperty(key) !== null && element[key] !== undefined && element[key] !== null))
  );
}

function hasChoiceValue(element: unknown, base: string): boolean {
  if (!isPlainObject(element)) return false;
  if (element[base] !== undefined && element[base] !== null) return true;

  return Object.keys(element).some((key) => isConcreteChoiceProperty(key, base) && element[key] !== undefined && element[key] !== null);
}

function validateMinimumPerParent(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  relativePath: string,
  minimum: number,
): ValidationIssue[] {
  return getChildCardinalities(element, relativePath).flatMap((cardinality) => {
    if (cardinality.count >= minimum) return [];

    const issuePath = appendRelativePath(elementPath, cardinality.path);
    return [
      createValidationIssue({
        code: "structural-cardinality-min",
        path: issuePath,
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Element ${issuePath} has too few values: expected at least ${minimum}, found ${cardinality.count}`,
        details: {
          sliceName: slice.sliceName,
          relativePath,
          expectedMin: minimum,
          actualCount: cardinality.count,
        },
      }),
    ];
  });
}

function appendRelativePath(basePath: string, relativePath: string): string {
  return relativePath ? `${basePath}.${relativePath}` : basePath;
}
