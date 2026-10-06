import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { SliceDefinition } from './slice-types.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';

/**
 * A slice the profile leaves without a discriminating value cannot claim any
 * element, so the reference validator reports every element it has to slice
 * as an error ("Slicing cannot be evaluated"). The profile, not the instance,
 * is at fault; the slice's own cardinality is not checked.
 */
export function buildUndiscriminatedSliceIssues(
  elements: unknown[],
  slices: SliceDefinition[],
  elementPath: string,
  profileUrl: string | undefined,
): ValidationIssue[] {
  const undiscriminated = slices.filter(slice => slice.undiscriminated);
  return elements.flatMap((_, index) => undiscriminated.map(slice => createValidationIssue({
    code: 'profile-slice-validation-error',
    path: `${elementPath}[${index}]`,
    resourceType: resourceTypeFromPath(elementPath),
    profile: profileUrl,
    severityOverride: 'error',
    customMessage: `Slicing cannot be evaluated: slice '${slice.path}:${slice.sliceName}'`
      + `${profileUrl ? ` in profile ${profileUrl}` : ''} has no fixed value, pattern or required binding`
      + ' for its discriminator',
    details: { sliceName: slice.sliceName, reason: 'undiscriminated-slice' },
  })));
}
