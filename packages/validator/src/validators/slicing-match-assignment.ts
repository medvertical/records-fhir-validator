import type { SlicingDefinition } from '../core/structure-definition-types.js';
import {
  elementCountsForSliceCardinality,
  matchElementToSlice,
  referenceDiscriminatorCouldNotBeResolved,
} from './slicing-match-policy.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';

export interface SliceElementMatch {
  element: unknown;
  index: number;
}

export interface SlicingMatchAssignment {
  sliceMatches: Map<string, SliceElementMatch[]>;
  cardinalityMatches: Map<string, SliceElementMatch[]>;
  unmatchedElements: SliceElementMatch[];
  hasUnresolvedReferenceDiscriminator: boolean;
}

export function assignElementsToSlices(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  referenceResolver: ReferenceResolver | null,
): SlicingMatchAssignment {
  const sliceMatches = new Map<string, SliceElementMatch[]>();
  const cardinalityMatches = new Map<string, SliceElementMatch[]>();
  const unmatchedElements: SliceElementMatch[] = [];
  const discriminators = slicing.discriminator ?? [];

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const matchedSlice = matchElementToSlice(element, slices, slicing, referenceResolver);
    if (!matchedSlice) {
      unmatchedElements.push({ element, index });
      continue;
    }

    appendMatch(sliceMatches, matchedSlice.sliceName, { element, index });
    if (elementCountsForSliceCardinality(
      element,
      matchedSlice,
      discriminators,
      slices,
      referenceResolver,
      slicing.rules,
    )) {
      appendMatch(cardinalityMatches, matchedSlice.sliceName, { element, index });
    }
  }

  return {
    sliceMatches,
    cardinalityMatches,
    unmatchedElements,
    hasUnresolvedReferenceDiscriminator: elements.some(element => discriminators.some(discriminator => (
      referenceDiscriminatorCouldNotBeResolved(element, discriminator, referenceResolver)
    ))),
  };
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
