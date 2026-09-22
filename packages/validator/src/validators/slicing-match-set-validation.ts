import { createValidationIssue } from '../issues/index.js';
import type { SlicingDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  matchElementToSlice,
  shouldSuppressUnresolvedBindingClosedUnmatched,
} from './slicing-match-policy.js';
import { validateSliceOrdering } from './slicing-ordering.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';

interface SlicingMatchSetValidationOptions {
  elements: unknown[];
  elementPath: string;
  slices: SliceDefinition[];
  slicing: SlicingDefinition;
  cardinalityMatches: ReadonlyMap<string, readonly unknown[]>;
  unmatchedElementCount: number;
  hasUnresolvedReferenceDiscriminator: boolean;
  hasUnresolvedSliceIdentity: boolean;
  referenceResolver: ReferenceResolver | null;
}

export function validateSlicingMatchSet({
  elements,
  elementPath,
  slices,
  slicing,
  cardinalityMatches,
  unmatchedElementCount,
  hasUnresolvedReferenceDiscriminator,
  hasUnresolvedSliceIdentity,
  referenceResolver,
}: SlicingMatchSetValidationOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (
    hasUnresolvedReferenceDiscriminator &&
    slices.some(slice => (cardinalityMatches.get(slice.sliceName)?.length ?? 0) < slice.min)
  ) {
    issues.push(createValidationIssue({
      code: 'profile-slice-validation-error',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      severityOverride: 'information',
      customMessage:
        `Slicing at '${elementPath}' could not be verified because a reference used by its ` +
        'discriminator could not be resolved.',
      details: {
        reason: 'unresolved-reference-discriminator',
      },
    }));
  }

  if (
    unmatchedElementCount > 0 &&
    slicing.rules === 'closed' &&
    !hasUnresolvedReferenceDiscriminator &&
    !hasUnresolvedSliceIdentity &&
    !shouldSuppressUnresolvedBindingClosedUnmatched(slices, slicing)
  ) {
    issues.push(createValidationIssue({
      code: 'profile-slice-closed-unmatched',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      messageParams: { path: elementPath, count: unmatchedElementCount },
    }));
  }

  if (slicing.ordered || slicing.rules === 'openAtEnd') {
    issues.push(...validateSliceOrdering(
      elements,
      slices,
      element => matchElementToSlice(element, slices, slicing, referenceResolver),
      elementPath,
      {
        ordered: slicing.ordered,
        rules: slicing.rules,
      },
    ));
  }

  return issues;
}
