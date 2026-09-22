import type { SlicingDefinition, SlicingDiscriminator } from '../core/structure-definition-types.js';
import { urlMatchesRequestedFhirVersion, type FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import {
  matchDiscriminator,
  sliceHasDiscriminatorEvidence,
} from './slice-discriminator-matcher.js';
import { isRelaxedCodingIdentityCardinalityMatch } from './slicing-cardinality-relaxation.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';
import { codingMatchesBindingCodes, getValueAtPath, matchesPattern } from './slice-utils.js';

export function matchElementToSlice(
  element: unknown,
  slices: SliceDefinition[],
  slicingDef: SlicingDefinition,
  resolver: ReferenceResolver | null,
): SliceDefinition | null {
  return slices.find(slice => elementMatchesSlice(
    element,
    slice,
    slicingDef.discriminator ?? [],
    slices,
    resolver,
  )) ?? null;
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
  return candidates.some(candidate => referenceCannotBeResolved(candidate, resolver));
}

function referenceCannotBeResolved(
  referenceValue: unknown,
  resolver: ReferenceResolver | null,
): boolean {
  if (!isRecord(referenceValue)) return false;
  const meta = isRecord(referenceValue.meta) ? referenceValue.meta : null;
  if (meta?.profile) return false;
  const reference = referenceValue.reference;
  if (typeof reference !== 'string') return false;
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
