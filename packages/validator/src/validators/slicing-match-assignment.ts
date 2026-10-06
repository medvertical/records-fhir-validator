import { assessResolvedTypeElementMatch } from './slice-resolved-type-evidence.js';
import type { SlicingDefinition } from '../core/structure-definition-types.js';
import {
  elementCountsForSliceCardinality,
  matchElementToSlice,
  referenceDiscriminatorCouldNotBeResolved,
  assessResolvedCodeElementMatch,
  assessDirectExistsElementMatch,
  assessDirectProfileElementMatch,
} from './slicing-match-policy.js';
import { assessValidatedProfileNonmembers } from './slice-profile-nonmember-proof.js';
import { resolvedCodeTargetIsUnavailable } from './slice-resolved-code-discriminator.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';

export interface SliceElementMatch {
  element: unknown;
  index: number;
}

export interface SlicingMatchAssignment {
  sliceMatches: Map<string, SliceElementMatch[]>;
  cardinalityMatches: Map<string, SliceElementMatch[]>;
  /** Ambiguous and unverified occurrences bound possible minima without assignment. */
  possibleCardinalityMatches: Map<string, SliceElementMatch[]>;
  unresolvedCodeMetadataElements: SliceElementMatch[];
  unmatchedElements: SliceElementMatch[];
  /** Null retains the existing policy when no supported per-occurrence receipt exists. */
  provedUnmatchedElements: SliceElementMatch[] | null;
  hasUnresolvedReferenceDiscriminator: boolean;
  hasUnverifiedProfileConformance?: boolean;
  hasDirectProfileConformanceEvidence?: boolean;
  hasUnverifiedResolvedType?: boolean;
  /** An unresolved discriminator reads the target itself, not just its type. */
  unresolvedDiscriminatorReadsTarget: boolean;
}

export function assignElementsToSlices(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  referenceResolver: ReferenceResolver | null,
): SlicingMatchAssignment {
  const sliceMatches = new Map<string, SliceElementMatch[]>();
  const cardinalityMatches = new Map<string, SliceElementMatch[]>();
  const possibleCardinalityMatches = new Map<string, SliceElementMatch[]>();
  const unresolvedCodeMetadataElements: SliceElementMatch[] = [];
  const unmatchedElements: SliceElementMatch[] = [];
  let hasUnverifiedResolvedType = false;
  const discriminators = slicing.discriminator ?? [];
  const profileProof = assessValidatedProfileNonmembers(elements, slices, slicing, referenceResolver,
    element => matchElementToSlice(element, slices, slicing, referenceResolver));
  let hasDirectProfileConformanceEvidence = assessDirectProfileElementMatch(undefined, slices, slicing, referenceResolver) !== null;
  let hasUnverifiedDirectProfile = false;
  let provedUnmatchedElements: SliceElementMatch[] | null = profileProof ? [] : null;
  const unknownElementIndices = new Set<number>(profileProof?.unverifiedIndices);

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const typeProof = assessResolvedTypeElementMatch(element, slices);
    hasUnverifiedResolvedType ||= typeProof?.state === 'unknown';
    const directProfileProof = assessDirectProfileElementMatch(element, slices, slicing, referenceResolver);
    hasDirectProfileConformanceEvidence ||= directProfileProof !== null;
    hasUnverifiedDirectProfile ||= (directProfileProof?.unknownSlices.length ?? 0) > 0;
    const proof = directProfileProof
      ?? assessResolvedCodeElementMatch(element, slices, slicing, referenceResolver)
      ?? assessDirectExistsElementMatch(element, slices, slicing, referenceResolver)
      ?? typeProof;
    if (proof?.hasUnresolvedCodeMetadata) unresolvedCodeMetadataElements.push({ element, index });
    for (const slice of proof?.unknownSlices ?? []) {
      appendMatch(possibleCardinalityMatches, slice.sliceName, { element, index });
    }
    if (proof && provedUnmatchedElements === null) provedUnmatchedElements = [];
    if (proof?.state === 'unknown') unknownElementIndices.add(index);
    if (proof?.state === 'ambiguous') {
      for (const slice of proof.possibleSlices) {
        if (proof.certainAncestorSlices.includes(slice)) {
          appendKnownMembership(sliceMatches, cardinalityMatches, { element, index }, slice, slices, slicing, referenceResolver);
        } else appendMatch(possibleCardinalityMatches, slice.sliceName, { element, index });
      }
      continue;
    }
    const profileNonmember = profileProof?.nonmemberIndices.has(index) === true;
    const matchedSlice = profileNonmember ? null
      : proof ? proof.slice : matchElementToSlice(element, slices, slicing, referenceResolver);
    if (!matchedSlice) {
      unmatchedElements.push({ element, index });
      if (proof?.state === 'nonmember' || profileNonmember) provedUnmatchedElements?.push({ element, index });
      continue;
    }

    // A proved reslice occurrence also belongs to its proved ancestor slices.
    for (const member of proof?.state === 'matched' ? proof.matchedSlices : [matchedSlice]) {
      appendKnownMembership(sliceMatches, cardinalityMatches, { element, index }, member, slices, slicing, referenceResolver);
    }
  }

  const unresolvedDiscriminators = discriminators.filter(discriminator => elements.some((element, index) => (
    (provedUnmatchedElements === null || unknownElementIndices.has(index)) && (
      referenceDiscriminatorCouldNotBeResolved(element, discriminator, referenceResolver)
      || resolvedCodeTargetIsUnavailable(element, discriminator, referenceResolver)
    )
  )));
  return {
    sliceMatches,
    cardinalityMatches,
    possibleCardinalityMatches,
    unresolvedCodeMetadataElements,
    unmatchedElements,
    provedUnmatchedElements,
    hasUnresolvedReferenceDiscriminator: unresolvedDiscriminators.length > 0,
    ...(profileProof || hasDirectProfileConformanceEvidence ? {
      hasUnverifiedProfileConformance: hasUnverifiedDirectProfile || (profileProof?.unverifiedIndices.size ?? 0) > 0,
    } : {}),
    ...(hasDirectProfileConformanceEvidence ? { hasDirectProfileConformanceEvidence } : {}),
    ...(slices.some(slice => slice.resolvedTypeEvidence) ? { hasUnverifiedResolvedType } : {}),
    unresolvedDiscriminatorReadsTarget: unresolvedDiscriminators.some(discriminator => discriminator.type !== 'type'),
  };
}

function appendKnownMembership(
  sliceMatches: Map<string, SliceElementMatch[]>,
  cardinalityMatches: Map<string, SliceElementMatch[]>,
  occurrence: SliceElementMatch,
  slice: SliceDefinition,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
): void {
  appendMatch(sliceMatches, slice.sliceName, occurrence);
  if (elementCountsForSliceCardinality(
    occurrence.element, slice, slicing.discriminator ?? [], slices, resolver, slicing.rules,
  )) appendMatch(cardinalityMatches, slice.sliceName, occurrence);
}

function appendMatch(
  matches: Map<string, SliceElementMatch[]>,
  sliceName: string,
  match: SliceElementMatch,
): void {
  const existing = matches.get(sliceName);
  if (existing) existing.push(match);
  else matches.set(sliceName, [match]);
}
