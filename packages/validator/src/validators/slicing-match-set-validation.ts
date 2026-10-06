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
  provedUnmatchedElements?: readonly { index: number }[] | null;
  hasUnresolvedReferenceDiscriminator: boolean;
  hasUnverifiedProfileConformance?: boolean;
  hasUnverifiedResolvedType?: boolean;
  unresolvedDiscriminatorReadsTarget: boolean;
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
  provedUnmatchedElements,
  hasUnresolvedReferenceDiscriminator,
  hasUnverifiedProfileConformance,
  hasUnverifiedResolvedType,
  unresolvedDiscriminatorReadsTarget,
  hasUnresolvedSliceIdentity,
  referenceResolver,
}: SlicingMatchSetValidationOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // The reference validator counts a target it cannot read as matching no
  // slice. Records leaves the slice undecided instead: advice for a type
  // discriminator, whose type the reference itself usually names, but a
  // warning where the slice depends on the target's profile or content.
  if (
    hasUnresolvedReferenceDiscriminator && (
      slices.some(slice => (cardinalityMatches.get(slice.sliceName)?.length ?? 0) < slice.min)
      || (slicing.rules === 'closed' && unmatchedElementCount > 0)
      || provedUnmatchedElements != null
    )
  ) {
    issues.push(createValidationIssue({
      code: 'profile-slice-validation-incomplete',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      severityOverride: unresolvedDiscriminatorReadsTarget ? 'warning' : 'information',
      customMessage:
        `Slicing at '${elementPath}' could not be verified because a reference used by its ` +
        'discriminator could not be resolved.',
      details: {
        reason: 'unresolved-reference-discriminator',
        validationComplete: false,
        validationStatus: 'incomplete',
      },
    }));
  }

  if (hasUnverifiedProfileConformance && !hasUnresolvedReferenceDiscriminator) {
    issues.push(createValidationIssue({
      code: 'profile-slice-validation-incomplete',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      severityOverride: 'warning',
      customMessage: `Slicing at '${elementPath}' could not be verified because target profile conformance is unknown.`,
      details: {
        reason: 'unverified-profile-conformance',
        validationComplete: false,
        validationStatus: 'incomplete',
      },
    }));
  }

  if (hasUnverifiedResolvedType && !hasUnresolvedReferenceDiscriminator) {
    issues.push(createValidationIssue({
      code: 'profile-slice-validation-incomplete',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      severityOverride: 'information',
      customMessage: `Slicing at '${elementPath}' could not be verified because the selected target type is unknown.`,
      details: { reason: 'unverified-target-type', validationComplete: false, validationStatus: 'incomplete' },
    }));
  }

  const closedUnmatchedCount = provedUnmatchedElements != null ? provedUnmatchedElements.length
    : !hasUnresolvedReferenceDiscriminator && !hasUnresolvedSliceIdentity
      && !shouldSuppressUnresolvedBindingClosedUnmatched(slices, slicing) ? unmatchedElementCount : 0;
  if (closedUnmatchedCount > 0 && slicing.rules === 'closed') {
    issues.push(createValidationIssue({
      code: 'profile-slice-closed-unmatched',
      path: elementPath,
      resourceType: resourceTypeFromPath(elementPath),
      messageParams: { path: elementPath, count: closedUnmatchedCount },
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
        ...(provedUnmatchedElements != null ? { knownNonmemberIndices: new Set(provedUnmatchedElements.map(element => element.index)) } : {}),
      },
    ));
  }

  return issues;
}
