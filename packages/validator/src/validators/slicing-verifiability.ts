import type {
  SlicingDefinition,
  SlicingDiscriminator,
} from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { sliceHasDiscriminatorEvidence } from './slice-discriminator-matcher.js';
import { hasUnresolvedChildBindingDiscriminator, usesDirectExistsDiscrimination } from './slice-discriminator-constraints.js';
import type { SliceDefinition } from './slice-types.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';

export interface SlicingVerifiabilityAssessment {
  blockingIssues: ValidationIssue[];
  advisoryIssues: ValidationIssue[];
  unresolvedSliceNames: Set<string>;
}

export function assessSlicingVerifiability({
  slices,
  slicing,
  elementPath,
}: {
  slices: SliceDefinition[];
  slicing: SlicingDefinition;
  elementPath: string;
}): SlicingVerifiabilityAssessment {
  const discriminators = slicing.discriminator ?? [];
  const completeness = { validationComplete: false, validationStatus: 'incomplete' };
  const everySliceUndiscriminated = slices.length > 0 && slices.every(slice => slice.undiscriminated);
  const unresolvedDiscriminators = everySliceUndiscriminated ? [] : discriminators
    .filter(discriminator => !hasEvidenceInAnySlice(slices, discriminator))
    .map(discriminator => `${discriminator.type}:${discriminator.path || '$this'}`);

  if (unresolvedDiscriminators.length > 0) {
    return {
      blockingIssues: [createValidationIssue({
        code: 'profile-slice-validation-incomplete',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        severityOverride: 'information',
        customMessage:
          `Slicing at '${elementPath}' could not be verified because inherited discriminator metadata `
          + 'was not resolved from the profile dependency.',
        details: {
          reason: 'unresolved-discriminator-metadata',
          ...completeness,
          unresolvedDiscriminators,
        },
      })],
      advisoryIssues: [],
      unresolvedSliceNames: new Set(),
    };
  }

  const unresolvedSliceNames = new Set(
    slices
      .filter(slice => discriminators.some(discriminator => hasUnresolvedChildBindingDiscriminator(slice, discriminator))
        || !discriminators.some(discriminator => sliceHasDiscriminatorEvidence(slice, discriminator))
        || discriminators.some(discriminator => usesDirectExistsDiscrimination([discriminator])
          && !sliceHasDiscriminatorEvidence(slice, discriminator)))
      .map(slice => slice.sliceName),
  );
  // A slice the profile itself leaves undiscriminated is reported as an
  // error per element (slicing-undiscriminated-slices.ts), not as missing
  // inherited metadata.
  const unexplainedSliceNames = slices
    .filter(slice => unresolvedSliceNames.has(slice.sliceName) && !slice.undiscriminated)
    .map(slice => slice.sliceName);
  const advisoryIssues = unexplainedSliceNames.length > 0
    ? [createValidationIssue({
        code: 'profile-slice-validation-incomplete',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        severityOverride: 'information',
        customMessage:
          `Slicing at '${elementPath}' could not be fully verified because inherited discriminator `
          + 'metadata was not resolved for one or more slices.',
        details: {
          reason: 'unresolved-slice-discriminator-metadata',
          ...completeness,
          unresolvedSliceNames: unexplainedSliceNames,
        },
      })]
    : [];

  return { blockingIssues: [], advisoryIssues, unresolvedSliceNames };
}

function hasEvidenceInAnySlice(
  slices: SliceDefinition[],
  discriminator: SlicingDiscriminator,
): boolean {
  return slices.some(slice => sliceHasDiscriminatorEvidence(slice, discriminator));
}
