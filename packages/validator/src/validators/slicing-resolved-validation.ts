import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import { prepareResolvedTypeEvidence } from './slice-resolved-type-evidence.js';
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
import { buildFiniteSliceMinimumIssues, hasAttestedUnconditionalGroup, validateMatchedSlices } from './slicing-slice-validation.js';
import { prepareDeclaredProfileAncestry } from './slice-profile-ancestry.js';
import { prepareSliceProfileTypes } from './slice-profile-types.js';
import { prepareValidatedProfileConformance } from './slice-validated-conformance.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';
import { buildUndiscriminatedSliceIssues } from './slicing-undiscriminated-slices.js';
import { assessSlicingVerifiability } from './slicing-verifiability.js';
import { normalizeDiscriminatorPath, usesDirectExistsDiscrimination } from './slice-discriminator-constraints.js';
import { usesResolvedCodeDiscrimination } from './slice-resolved-code-discriminator.js';

interface ResolvedSlicingValidationOptions {
  elements: unknown[];
  elementPath: string;
  /** The sliced element's path in the profile, when `elementPath` is its place in the instance. */
  definitionPath?: string;
  selectedSlicingElementId?: string;
  profile: StructureDefinition;
  slices: SliceDefinition[];
  slicing: SlicingDefinition;
  referenceResolver: ReferenceResolver | null;
  typeProfileResolver: ((profileUrl: string) => Promise<StructureDefinition | null>) | null;
  typeProfileConstraintValidator: ConstraintValidator;
  mustSupportSeverity: 'warning' | 'information';
  fhirVersion: FhirVersionFamily;
  rootResource?: unknown;
  profileConformance?: Parameters<typeof validateMatchedSlices>[0]['profileConformance'];
}

/** Validate elements after slice metadata and FHIR-version compatibility are resolved. */
export async function validateResolvedSlicing(
  options: ResolvedSlicingValidationOptions,
): Promise<ValidationIssue[]> {
  options = withInvocationProfileResolution(options);
  const verifiability = assessSlicingVerifiability({
    slices: options.slices,
    slicing: options.slicing,
    elementPath: options.elementPath,
  });
  // With nothing present there is nothing to identify; required slices are
  // simply missing.
  if (verifiability.blockingIssues.length > 0 && options.elements.length > 0) {
    if (!usesResolvedCodeDiscrimination(options.slicing.discriminator ?? [])
      && !usesDirectExistsDiscrimination(options.slicing.discriminator ?? [])) {
      return [...verifiability.blockingIssues, ...buildFiniteSliceMinimumIssues(options)];
    }
    const assignment = assignElementsToSlices(
      options.elements, options.slices, options.slicing, options.referenceResolver,
    );
    return [
      ...verifiability.blockingIssues,
      ...(await validateMatchedSlices({
        ...options, ...assignment, unresolvedSliceNames: verifiability.unresolvedSliceNames,
      })),
      ...validateSlicingMatchSet({
        ...options,
        cardinalityMatches: assignment.cardinalityMatches,
        unmatchedElementCount: assignment.unmatchedElements.length,
        provedUnmatchedElements: assignment.provedUnmatchedElements,
        hasUnverifiedProfileConformance: assignment.hasUnverifiedProfileConformance,
        hasUnverifiedResolvedType: assignment.hasUnverifiedResolvedType,
        hasUnresolvedReferenceDiscriminator: assignment.hasUnresolvedReferenceDiscriminator,
        unresolvedDiscriminatorReadsTarget: assignment.unresolvedDiscriminatorReadsTarget,
        hasUnresolvedSliceIdentity: true,
      }),
    ];
  }

  const issues = [
    ...verifiability.advisoryIssues,
    ...buildUndiscriminatedSliceIssues(
      options.elements,
      options.slices,
      options.elementPath,
      options.profile?.url,
    ),
  ];
  const slices = await prepareResolvedSlices(options);
  options = { ...options, slices };
  const assignment = assignElementsToSlices(
    options.elements,
    options.slices,
    options.slicing,
    options.referenceResolver,
  );
  issues.push(...buildResolvedCodeMetadataIssues(assignment, verifiability, options.elementPath));
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
      ...options, ...assignment,
      hasUnresolvedReferenceDiscriminator: assignment.hasUnresolvedReferenceDiscriminator
        || assignment.hasUnverifiedProfileConformance === true
        || assignment.hasUnverifiedResolvedType === true,
      definitionPath: options.definitionPath ?? options.elementPath,
      unresolvedSliceNames: verifiability.unresolvedSliceNames,
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
      provedUnmatchedElements: assignment.provedUnmatchedElements,
      hasUnverifiedProfileConformance: assignment.hasUnverifiedProfileConformance,
      hasUnverifiedResolvedType: assignment.hasUnverifiedResolvedType,
      hasUnresolvedReferenceDiscriminator: assignment.hasUnresolvedReferenceDiscriminator,
      unresolvedDiscriminatorReadsTarget: assignment.unresolvedDiscriminatorReadsTarget,
      hasUnresolvedSliceIdentity: verifiability.unresolvedSliceNames.size > 0,
      referenceResolver: options.referenceResolver,
    }),
  );

  // Open slicing permits unmatched elements, but the reference validator still
  // says so: an element nobody claimed is usually an unnoticed authoring slip,
  // and staying silent about it was a parity gap.
  const knownUnmatchedElements = assignment.provedUnmatchedElements ?? assignment.unmatchedElements;
  if (knownUnmatchedElements.length > 0 && options.slicing.rules !== 'closed') {
    for (const { index } of knownUnmatchedElements) {
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

function withInvocationProfileResolution(options: ResolvedSlicingValidationOptions): ResolvedSlicingValidationOptions {
  const resolver = options.referenceResolver;
  const discriminator = options.slicing.discriminator?.[0];
  if (!resolver || options.slicing.discriminator?.length !== 1 || discriminator?.type !== 'profile') return options;
  const step = splitResolveDiscriminatorPath(normalizeDiscriminatorPath(discriminator.path || '$this'));
  if (!step || (step.remainder && step.remainder !== '$this')) return options;
  // Prepared profile receipts use object identity; every consumer must see the same resolution.
  const resolutions = new Map<string, { value: unknown } | { error: unknown }>();
  return { ...options, referenceResolver: reference => {
    let resolution = resolutions.get(reference);
    if (!resolution) {
      try { resolution = { value: resolver(reference) }; }
      catch (error) { resolution = { error }; }
      resolutions.set(reference, resolution);
    }
    if ('error' in resolution) throw resolution.error;
    return resolution.value;
  } };
}

async function prepareResolvedSlices(options: ResolvedSlicingValidationOptions): Promise<SliceDefinition[]> {
  await prepareDeclaredProfileAncestry(options.elements, options.slicing, options.typeProfileResolver);
  await prepareSliceProfileTypes(options.elements, options.slices, options.slicing, options.typeProfileResolver, {
    fhirVersion: options.fhirVersion, rootResource: options.rootResource, elementPath: options.elementPath,
  });
  const attestedGroup = hasAttestedUnconditionalGroup({ ...options, definitionPath: options.definitionPath ?? options.elementPath });
  const typeSlices = await prepareResolvedTypeEvidence({ ...options, attestedGroup });
  return prepareValidatedProfileConformance(
    options.elements, typeSlices, options.slicing, options.typeProfileResolver, options.profileConformance,
    options.referenceResolver,
    attestedGroup,
    options.fhirVersion,
  );
}

function buildResolvedCodeMetadataIssues(
  assignment: ReturnType<typeof assignElementsToSlices>,
  verifiability: ReturnType<typeof assessSlicingVerifiability>,
  elementPath: string,
): ValidationIssue[] {
  if (assignment.unresolvedCodeMetadataElements.length === 0
    || assignment.hasUnresolvedReferenceDiscriminator
    || verifiability.advisoryIssues.length > 0) return [];
  return [createValidationIssue({
    code: 'profile-slice-validation-incomplete',
    path: elementPath,
    resourceType: resourceTypeFromPath(elementPath),
    severityOverride: 'information',
    customMessage: `Slicing at '${elementPath}' could not be fully verified because `
      + 'code discriminator metadata was not resolved for one or more possible slices.',
    details: {
      reason: 'unresolved-slice-discriminator-metadata',
      validationComplete: false,
      validationStatus: 'incomplete',
      unresolvedElementIndices: assignment.unresolvedCodeMetadataElements.map(element => element.index),
    },
  })];
}
