import type {
  SlicingDefinition,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import type { FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ConstraintValidator } from './constraint-validator.js';
import { buildAmbiguousSliceMatchIssues } from './slicing-ambiguous-matches.js';
import { assignElementsToSlices } from './slicing-match-assignment.js';
import { validateSlicingMatchSet } from './slicing-match-set-validation.js';
import { buildMissingDiscriminatorIssues } from './slicing-missing-discriminator.js';
import { createValidationIssue } from '../issues/index.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';
import { validateMatchedSlices } from './slicing-slice-validation.js';
import { prepareDeclaredProfileAncestry } from './slice-profile-ancestry.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';
import { assessSlicingVerifiability } from './slicing-verifiability.js';

interface ResolvedSlicingValidationOptions {
  elements: unknown[];
  elementPath: string;
  profile: StructureDefinition;
  slices: SliceDefinition[];
  slicing: SlicingDefinition;
  referenceResolver: ReferenceResolver | null;
  typeProfileResolver: ((profileUrl: string) => Promise<StructureDefinition | null>) | null;
  typeProfileConstraintValidator: ConstraintValidator;
  mustSupportSeverity: 'warning' | 'information';
  fhirVersion: FhirVersionFamily;
  rootResource?: unknown;
}

/** Validate elements after slice metadata and FHIR-version compatibility are resolved. */
export async function validateResolvedSlicing(
  options: ResolvedSlicingValidationOptions,
): Promise<ValidationIssue[]> {
  const verifiability = assessSlicingVerifiability({
    slices: options.slices,
    slicing: options.slicing,
    elementPath: options.elementPath,
  });
  if (verifiability.blockingIssues.length > 0) {
    return verifiability.blockingIssues;
  }

  const issues = [...verifiability.advisoryIssues];
  await prepareDeclaredProfileAncestry(
    options.elements,
    options.slicing,
    options.typeProfileResolver,
  );
  const assignment = assignElementsToSlices(
    options.elements,
    options.slices,
    options.slicing,
    options.referenceResolver,
  );
  issues.push(
    ...buildAmbiguousSliceMatchIssues({
      elements: options.elements,
      slices: options.slices,
      slicing: options.slicing,
      referenceResolver: options.referenceResolver,
      elementPath: options.elementPath,
      profileUrl: options.profile.url,
    }),
  );
  issues.push(
    ...(await validateMatchedSlices({
      elements: options.elements,
      elementPath: options.elementPath,
      profile: options.profile,
      slices: options.slices,
      unresolvedSliceNames: verifiability.unresolvedSliceNames,
      sliceMatches: assignment.sliceMatches,
      cardinalityMatches: assignment.cardinalityMatches,
      hasUnresolvedReferenceDiscriminator: assignment.hasUnresolvedReferenceDiscriminator,
      mustSupportSeverity: options.mustSupportSeverity,
      fhirVersion: options.fhirVersion,
      typeProfileResolver: options.typeProfileResolver,
      typeProfileConstraintValidator: options.typeProfileConstraintValidator,
      rootResource: options.rootResource,
    })),
  );
  issues.push(
    ...validateSlicingMatchSet({
      elements: options.elements,
      elementPath: options.elementPath,
      slices: options.slices,
      slicing: options.slicing,
      cardinalityMatches: assignment.cardinalityMatches,
      unmatchedElementCount: assignment.unmatchedElements.length,
      hasUnresolvedReferenceDiscriminator: assignment.hasUnresolvedReferenceDiscriminator,
      hasUnresolvedSliceIdentity: verifiability.unresolvedSliceNames.size > 0,
      referenceResolver: options.referenceResolver,
    }),
  );

  // Open slicing permits unmatched elements, but the reference validator still
  // says so: an element nobody claimed is usually an unnoticed authoring slip,
  // and staying silent about it was a parity gap.
  if (assignment.unmatchedElements.length > 0 && options.slicing.rules !== 'closed') {
    for (const { index } of assignment.unmatchedElements) {
      issues.push(createValidationIssue({
        code: 'profile-slice-open-unmatched',
        path: `${options.elementPath}[${index}]`,
        resourceType: resourceTypeFromPath(options.elementPath),
        profile: options.profile?.url,
        messageParams: { profile: options.profile?.url ?? '' },
        severityOverride: 'information',
      }));
    }
  }

  if (assignment.unmatchedElements.length > 0) {
    issues.push(
      ...buildMissingDiscriminatorIssues(
        assignment.unmatchedElements,
        options.slices,
        options.slicing,
        options.elementPath,
        options.profile,
      ),
    );
  }

  return issues;
}
