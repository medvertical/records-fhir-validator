import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { SliceDefinition } from './slice-types';
import { resourceTypeFromPath } from './slicing-content-rules';

export function validateSliceOrdering(
  elements: any[],
  slices: SliceDefinition[],
  matchElementToSlice: (element: any) => SliceDefinition | null,
  elementPath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sliceOrder = slices.map(s => s.sliceName);
  const elementSliceOrder: string[] = [];

  for (const element of elements) {
    const matchedSlice = matchElementToSlice(element);
    if (matchedSlice) {
      elementSliceOrder.push(matchedSlice.sliceName);
    }
  }

  let lastSliceIndex = -1;
  for (const sliceName of elementSliceOrder) {
    const currentSliceIndex = sliceOrder.indexOf(sliceName);
    if (currentSliceIndex < lastSliceIndex) {
      issues.push(createValidationIssue({
        code: 'profile-slice-ordering-violation',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        messageParams: { path: elementPath, sliceName },
      }));
      break;
    }
    lastSliceIndex = currentSliceIndex;
  }

  return issues;
}
