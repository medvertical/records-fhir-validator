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
import type { SliceDefinition } from './slice-types.js';
import { validateSliceTypeProfileConstraints } from './slicing-type-profile-constraints.js';

interface ValidateMatchedSlicesOptions {
  elements: unknown[];
  elementPath: string;
  profile: StructureDefinition;
  slices: SliceDefinition[];
  unresolvedSliceNames: ReadonlySet<string>;
  sliceMatches: ReadonlyMap<string, SliceElementMatch[]>;
  cardinalityMatches: ReadonlyMap<string, SliceElementMatch[]>;
  hasUnresolvedReferenceDiscriminator: boolean;
  mustSupportSeverity: 'warning' | 'information';
  fhirVersion: FhirVersionFamily;
  typeProfileResolver: ((profileUrl: string) => Promise<StructureDefinition | null>) | null;
  typeProfileConstraintValidator: ConstraintValidator;
  rootResource?: unknown;
}

export async function validateMatchedSlices(
  options: ValidateMatchedSlicesOptions,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const slice of options.slices) {
    if (options.unresolvedSliceNames.has(slice.sliceName)) continue;
    const matchedElements = options.sliceMatches.get(slice.sliceName) || [];
    const count = options.cardinalityMatches.get(slice.sliceName)?.length ?? 0;
    appendSliceCardinalityIssues(issues, slice, count, options);

    for (const matched of matchedElements) {
      const matchedPath = `${options.elementPath}[${matched.index}]`;
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
      ));
    }
  }
  return issues;
}

function appendSliceCardinalityIssues(
  issues: ValidationIssue[],
  slice: SliceDefinition,
  count: number,
  options: ValidateMatchedSlicesOptions,
): void {
  const resourceType = resourceTypeFromPath(options.elementPath);
  if (
    count < slice.min
    && !options.hasUnresolvedReferenceDiscriminator
    && !shouldSuppressUnresolvedBindingOnlyMin(slice, options.elements)
  ) {
    issues.push(createValidationIssue({
      code: 'profile-slice-min-cardinality',
      path: options.elementPath,
      resourceType,
      messageParams: { slice: slice.sliceName, min: slice.min, actual: count },
      ruleId: `slice-min-${slice.sliceName}`,
      details: { sliceName: slice.sliceName },
      target: {
        path: options.elementPath,
        elementId: `${options.elementPath}:${slice.sliceName}`,
        sliceName: slice.sliceName,
      },
    }));
  }

  if (slice.max === '*') return;
  const max = Number.parseInt(slice.max, 10);
  if (count <= max) return;
  issues.push(createValidationIssue({
    code: 'profile-slice-max-cardinality',
    path: options.elementPath,
    resourceType,
    messageParams: { slice: slice.sliceName, max: slice.max, actual: count },
    ruleId: `slice-max-${slice.sliceName}`,
    details: { sliceName: slice.sliceName },
  }));
}
