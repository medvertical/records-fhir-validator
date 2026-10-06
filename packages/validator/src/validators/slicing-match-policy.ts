import { directProfileSliceStates } from './slice-profile-nonmember-proof.js';
import { assessResolvedTypeElementMatch } from './slice-resolved-type-evidence.js';
import type { SlicingDefinition, SlicingDiscriminator } from '../core/structure-definition-types.js';
import { urlMatchesRequestedFhirVersion, type FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import {
  matchDiscriminator,
  sliceHasDiscriminatorEvidence,
} from './slice-discriminator-matcher.js';
import { usesDirectExistsDiscrimination } from './slice-discriminator-constraints.js';
import { isRelaxedCodingIdentityCardinalityMatch } from './slicing-cardinality-relaxation.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import type { ReferenceResolver, ResolvedCodeElementMatch, SliceDefinition } from './slice-types.js';
import { codingMatchesBindingCodes, getValueAtPath, matchesPattern } from './slice-utils.js';
import { assessResolvedCodeDiscriminator, requiredReferencePrecludesSlice, resolvedCodeDiscriminatorHasEvidence, usesResolvedCodeDiscrimination } from './slice-resolved-code-discriminator.js';

export function matchElementToSlice(
  element: unknown,
  slices: SliceDefinition[],
  slicingDef: SlicingDefinition,
  resolver: ReferenceResolver | null,
): SliceDefinition | null {
  const proof = assessDirectProfileElementMatch(element, slices, slicingDef, resolver)
    ?? assessResolvedCodeElementMatch(element, slices, slicingDef, resolver)
    ?? assessDirectExistsElementMatch(element, slices, slicingDef, resolver)
    ?? assessResolvedTypeElementMatch(element, slices);
  if (proof?.state === 'ambiguous') return proof.certainAncestorSlices[0] ?? null;
  if (proof) return proof.slice;
  return slices.find(slice => elementMatchesSlice(
    element,
    slice,
    slicingDef.discriminator ?? [],
    slices,
    resolver,
  )) ?? null;
}

/** Binding selection requires every competing slice to have a conclusive membership result. */
export function assessElementSliceMembership(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
): ResolvedCodeElementMatch {
  const profileProof = assessDirectProfileElementMatch(element, slices, slicing, resolver);
  if (profileProof) return profileProof;
  if (slicing.discriminator?.some(discriminator => discriminator.type === 'profile')) {
    return { state: 'unknown', slice: null, hasUnresolvedCodeMetadata: false, unknownSlices: slices };
  }
  return assessDiscriminatorElementMatch(element, slices, slicing, resolver);
}

export type { ResolvedCodeElementMatch } from './slice-types.js';

/** Only post-resolve code slicing uses complete per-occurrence identity evidence. */
export function assessResolvedCodeElementMatch(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
): ResolvedCodeElementMatch | null {
  if (!usesResolvedCodeDiscrimination(slicing.discriminator ?? [])) return null;
  return assessDiscriminatorElementMatch(element, slices, slicing, resolver);
}

/** Exact direct exists metadata supplies the same positive, negative and unknown identity facts. */
export function assessDirectExistsElementMatch(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
): ResolvedCodeElementMatch | null {
  if (!usesDirectExistsDiscrimination(slicing.discriminator ?? [])) return null;
  return assessDiscriminatorElementMatch(element, slices, slicing, resolver);
}

/** The same match policy consumes source-confirmed direct profile verdicts. */
export function assessDirectProfileElementMatch(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
): ResolvedCodeElementMatch | null {
  const states = directProfileSliceStates(element, slices, slicing);
  if (!states) return null;
  return assessDiscriminatorElementMatch(element, slices, slicing, resolver,
    slice => states.get(slice) === true ? 'matched' : states.get(slice) === false ? 'nonmember' : 'unknown');
}

function assessDiscriminatorElementMatch(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
  preparedState?: (slice: SliceDefinition) => 'matched' | 'nonmember' | 'unknown',
): ResolvedCodeElementMatch {
  const discriminators = slicing.discriminator ?? [];
  let unknown = false;
  let hasUnresolvedCodeMetadata = false;
  const possibleSlices: SliceDefinition[] = [];
  const unknownSlices: SliceDefinition[] = [];
  for (const slice of slices) {
    const state = preparedState ? preparedState(slice)
      : resolvedCodeSliceMatchState(element, slice, discriminators, slices, resolver);
    if (state === 'matched') possibleSlices.push(slice);
    if (state === 'unknown') {
      unknown = true;
      unknownSlices.push(slice);
      hasUnresolvedCodeMetadata ||= discriminators.some(discriminator =>
        (discriminator.type === 'value' || discriminator.type === 'pattern')
        && resolvedCodeDiscriminatorHasEvidence(slice, discriminator.path) === false);
    }
  }
  const conflictingSlices = possibleSlices.filter(slice => !possibleSlices.some(other =>
    other !== slice && other.sliceName.startsWith(`${slice.sliceName}/`)));
  if (conflictingSlices.length > 1) return {
    state: 'ambiguous', slice: null, possibleSlices, conflictingSlices, hasUnresolvedCodeMetadata, unknownSlices,
    certainAncestorSlices: possibleSlices.filter(slice => conflictingSlices.every(other =>
      other.sliceName.startsWith(`${slice.sliceName}/`))),
  };
  if (possibleSlices.length > 0) return {
    state: 'matched', slice: possibleSlices[0], matchedSlices: possibleSlices, hasUnresolvedCodeMetadata, unknownSlices,
  };
  return { state: unknown ? 'unknown' : 'nonmember', slice: null, hasUnresolvedCodeMetadata, unknownSlices };
}

function resolvedCodeSliceMatchState(
  element: unknown,
  slice: SliceDefinition,
  discriminators: SlicingDiscriminator[],
  allSlices: SliceDefinition[],
  resolver: ReferenceResolver | null,
): 'matched' | 'nonmember' | 'unknown' {
  if (requiredReferencePrecludesSlice(element, slice)) return 'nonmember';
  let unknown = discriminators.length === 0;
  for (const discriminator of discriminators) {
    const codeState = assessResolvedCodeDiscriminator(element, slice, discriminator, resolver, matchesPattern);
    if (codeState === 'nonmember') return 'nonmember';
    if (codeState === 'unknown') { unknown = true; continue; }
    if (codeState === 'matched') continue;
    if (!sliceHasDiscriminatorEvidence(slice, discriminator)
      || referenceDiscriminatorCouldNotBeResolved(element, discriminator, resolver)) { unknown = true; continue; }
    if (!matchDiscriminator(element, slice, discriminator, resolver, matchesPattern, codingMatchesBindingCodes, allSlices)) return 'nonmember';
  }
  return unknown ? 'unknown' : 'matched';
}

export function shouldSuppressUnresolvedBindingOnlyMin(
  slice: SliceDefinition,
  elements: unknown[],
): boolean {
  if (elements.length === 0 || !isUnresolvedBindingOnlySlice(slice)) return false;
  const discriminators = slice.discriminator ?? [];
  return discriminators.length > 0 && discriminators.every(discriminator =>
    (discriminator.type === 'pattern' || discriminator.type === 'value') &&
    (!discriminator.path || discriminator.path === '$this')
  );
}

export function referenceDiscriminatorCouldNotBeResolved(
  element: unknown,
  discriminator: SlicingDiscriminator,
  resolver: ReferenceResolver | null,
): boolean {
  const rawPath = discriminator.path || '$this';
  const resolveStep = splitResolveDiscriminatorPath(rawPath);
  if (!resolveStep && discriminator.type !== 'profile') return false;
  // `item.resolve()` resolves the Reference held by `item`; reading the sliced
  // element instead never finds a reference and every failure looks resolved.
  const referencePath = resolveStep?.referencePath ?? rawPath;
  const referenceValue = referencePath === '$this'
    ? element
    : getValueAtPath(element, referencePath);
  const candidates = Array.isArray(referenceValue) ? referenceValue : [referenceValue];
  return candidates.some(candidate => referenceCannotBeResolved(candidate, resolver, Boolean(resolveStep)));
}

function referenceCannotBeResolved(
  referenceValue: unknown,
  resolver: ReferenceResolver | null,
  resolvesTarget: boolean,
): boolean {
  // A canonical names its target as a Reference does (MedMorph's
  // relatedArtifact.resource.resolve()); one Records cannot read leaves the
  // slice undecided rather than unmatched.
  if (resolvesTarget && typeof referenceValue === 'string') return targetCannotBeResolved(referenceValue, resolver);
  if (!isRecord(referenceValue)) return false;
  const meta = isRecord(referenceValue.meta) ? referenceValue.meta : null;
  if (meta?.profile) return false;
  const reference = referenceValue.reference;
  if (typeof reference !== 'string') return false;
  return targetCannotBeResolved(reference, resolver);
}

function targetCannotBeResolved(reference: string, resolver: ReferenceResolver | null): boolean {
  if (!resolver) return true;
  try { return resolver(reference) == null; } catch { return true; }
}

export function shouldSuppressUnresolvedBindingClosedUnmatched(
  slices: SliceDefinition[],
  slicingDef: SlicingDefinition,
): boolean {
  const discriminators = slicingDef.discriminator ?? [];
  if (slices.length === 0 || discriminators.length === 0) return false;
  if (!discriminators.every(discriminator =>
    (discriminator.type === 'pattern' || discriminator.type === 'value') &&
    (!discriminator.path || discriminator.path === '$this')
  )) return false;
  return slices.some(isUnresolvedBindingOnlySlice);
}

function isUnresolvedBindingOnlySlice(slice: SliceDefinition): boolean {
  return Boolean(slice.bindingValueSet) &&
    !slice.bindingCodes?.size &&
    slice.pattern === undefined &&
    slice.fixed === undefined &&
    (slice.childPatterns?.size ?? 0) === 0 &&
    (slice.childFixed?.size ?? 0) === 0;
}

export function isSliceCompatibleWithFhirVersion(
  slice: SliceDefinition,
  fhirVersion: FhirVersionFamily,
): boolean {
  const urls: string[] = [];
  for (const typeSpec of slice.type ?? []) {
    urls.push(...(typeSpec.profile ?? []), ...(typeSpec.targetProfile ?? []));
  }
  for (const typeSpecs of slice.childTypes?.values() ?? []) {
    for (const typeSpec of typeSpecs) {
      urls.push(...(typeSpec.profile ?? []), ...(typeSpec.targetProfile ?? []));
    }
  }
  return urls.every(url => urlMatchesRequestedFhirVersion(url, fhirVersion));
}

export function elementCountsForSliceCardinality(
  element: unknown,
  slice: SliceDefinition,
  discriminators: SlicingDiscriminator[],
  allSlices: SliceDefinition[],
  resolver: ReferenceResolver | null,
  slicingRules?: string,
): boolean {
  if (slicingRules !== 'closed') return true;
  return !isRelaxedCodingIdentityCardinalityMatch(
    element,
    slice,
    discriminators,
    (candidate, candidateSlice, discriminator) => matchDiscriminator(
      candidate,
      candidateSlice,
      discriminator,
      resolver,
      matchesPattern,
      codingMatchesBindingCodes,
      allSlices,
    ),
  );
}

function elementMatchesSlice(
  element: unknown,
  slice: SliceDefinition,
  discriminators: SlicingDiscriminator[],
  allSlices: SliceDefinition[],
  resolver: ReferenceResolver | null,
): boolean {
  if (discriminators.length === 0) return false;
  const resolvedDiscriminatorCount = discriminators.filter(discriminator =>
    sliceHasDiscriminatorEvidence(slice, discriminator)
  ).length;
  if (resolvedDiscriminatorCount === 0) return false;
  return discriminators.every(discriminator =>
    !sliceHasDiscriminatorEvidence(slice, discriminator) ||
    matchDiscriminator(
      element,
      slice,
      discriminator,
      resolver,
      matchesPattern,
      codingMatchesBindingCodes,
      allSlices,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
