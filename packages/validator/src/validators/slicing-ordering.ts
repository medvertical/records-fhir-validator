import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { SlicingDefinition } from '../core/structure-definition-types.js';
import type { SliceDefinition } from './slice-types.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';

interface SliceOrderingOptions {
  ordered?: boolean;
  rules?: SlicingDefinition['rules'];
}

export function validateSliceOrdering(
  elements: unknown[],
  slices: SliceDefinition[],
  matchElementToSlice: (element: unknown) => SliceDefinition | null,
  elementPath: string,
  options: SliceOrderingOptions = { ordered: true },
): ValidationIssue[] {
  const sliceOrder = slices.map(s => s.sliceName);
  let lastSliceIndex = -1;
  let unmatchedElementSeen = false;

  for (const element of elements) {
    const matchedSlice = matchElementToSlice(element);
    if (!matchedSlice) {
      unmatchedElementSeen = true;
      continue;
    }

    const violatesOpenAtEnd = options.rules === 'openAtEnd' && unmatchedElementSeen;
    const currentSliceIndex = sliceOrder.indexOf(matchedSlice.sliceName);
    const violatesDeclaredOrder = options.ordered && currentSliceIndex < lastSliceIndex;
    if (violatesOpenAtEnd || violatesDeclaredOrder) {
      return [createValidationIssue({
        code: 'profile-slice-ordering-violation',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        messageParams: { path: elementPath, sliceName: matchedSlice.sliceName },
        details: {
          sliceName: matchedSlice.sliceName,
          reason: violatesOpenAtEnd
            ? 'known-slice-after-open-at-end-content'
            : 'declared-slice-order',
        },
      })];
    }

    lastSliceIndex = currentSliceIndex;
  }

  return [];
}
