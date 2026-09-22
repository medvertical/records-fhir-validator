import type { SlicingDiscriminator } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { SliceDefinition } from './slice-types.js';
import {
  matchExistsDiscriminator,
  resolvedResourceMatchesSliceTargetProfile,
  resolveDiscriminatorPath,
} from './slice-discriminator-complex-matchers.js';
import {
  hasDirectDiscriminatorEvidence,
  normalizeDiscriminatorPath,
} from './slice-discriminator-constraints.js';
import {
  splitResolveDiscriminatorPath,
  type ResolveDiscriminatorStep,
} from './slice-discriminator-path.js';
import {
  matchProfileDiscriminator,
  profileListContains,
  toProfileArray,
  type ReferenceResolverFn,
} from './slice-profile-discriminator-matcher.js';
import { matchResolvedTypeDiscriminator, matchTypeDiscriminator } from './slice-type-discriminator.js';
import { matchPatternDiscriminator, matchValueDiscriminator } from './slice-discriminator-value-matchers.js';
import { getValueAtPath } from './slice-utils.js';

export type { ReferenceResolverFn } from './slice-profile-discriminator-matcher.js';
export { sliceHasDiscriminatorEvidence } from './slice-discriminator-constraints.js';

export function matchDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
  referenceResolver: ReferenceResolverFn,
  matchesPattern: (value: unknown, pattern: unknown) => boolean,
  matchesBinding: (value: unknown, codes: Set<string>) => boolean,
  allSlices?: SliceDefinition[],
): boolean {
  const path = normalizeDiscriminatorPath(discriminator.path);
  const resolveStep = splitResolveDiscriminatorPath(path);
  if (resolveStep) {
    return matchResolvedDiscriminator(
      element,
      slice,
      discriminator,
      resolveStep,
      referenceResolver,
      matchesPattern,
      matchesBinding,
      allSlices,
    );
  }
  switch (discriminator.type) {
    case 'value': return matchValueDiscriminator(element, slice, path, matchesPattern, matchesBinding);
    case 'pattern': return matchPatternDiscriminator(element, slice, path, matchesPattern, matchesBinding, allSlices);
    case 'type': return matchTypeDiscriminator(element, slice, path);
    case 'profile': return matchProfileDiscriminator(element, slice, path, referenceResolver, allSlices, matchesPattern);
    case 'exists': return matchExistsDiscriminator(element, path);
    default:
      logger.warn(`[SlicingValidator] Unsupported discriminator type: ${discriminator.type}`);
      return false;
  }
}

function matchResolvedDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
  step: ResolveDiscriminatorStep,
  referenceResolver: ReferenceResolverFn,
  matchesPattern: (value: unknown, pattern: unknown) => boolean,
  matchesBinding: (value: unknown, codes: Set<string>) => boolean,
  allSlices?: SliceDefinition[],
): boolean {
  // `item.resolve()` follows the Reference held by the child `item`; only a
  // path that starts with resolve() treats the sliced element as the Reference.
  const referenceValue = step.referencePath === '$this'
    ? element
    : getValueAtPath(element, step.referencePath);
  const references = Array.isArray(referenceValue) ? referenceValue : [referenceValue];
  return references.some(reference => {
    const resolved = resolveDiscriminatorPath(reference, step.referencePath, referenceResolver);
    return resolved !== null && matchResolvedTarget(
      resolved,
      slice,
      discriminator,
      step,
      referenceResolver,
      matchesPattern,
      matchesBinding,
      allSlices,
    );
  });
}

function matchResolvedTarget(
  resolved: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
  { referencePath, remainder }: ResolveDiscriminatorStep,
  referenceResolver: ReferenceResolverFn,
  matchesPattern: (value: unknown, pattern: unknown) => boolean,
  matchesBinding: (value: unknown, codes: Set<string>) => boolean,
  allSlices?: SliceDefinition[],
): boolean {
  // The type constraint that identifies the slice sits on the element holding
  // the Reference, so type specs are read at `referencePath`, not at `$this`.
  if (discriminator.type === 'type') {
    return matchResolvedTypeDiscriminator(resolved, slice, remainder, allSlices, referencePath);
  }
  if (discriminator.type === 'profile') {
    return matchProfileDiscriminator(
      resolved, slice, remainder || '$this', referenceResolver, allSlices, matchesPattern, referencePath,
    );
  }
  if (discriminator.type === 'exists') return matchExistsDiscriminator(resolved, remainder || '$this');
  const ofType = remainder.match(/^ofType\(([^)]+)\)$/);
  if (ofType) return isRecord(resolved) && resolved.resourceType === ofType[1];
  const conformsTo = remainder.match(/^conformsTo\('([^']+)'\)$/);
  if (conformsTo) {
    const meta = isRecord(resolved) && isRecord(resolved.meta) ? resolved.meta : null;
    return profileListContains(toProfileArray(meta?.profile), conformsTo[1]);
  }
  const directMatch = discriminator.type === 'pattern'
    ? matchPatternDiscriminator(resolved, slice, remainder || '$this', matchesPattern, matchesBinding, allSlices)
    : matchValueDiscriminator(resolved, slice, remainder || '$this', matchesPattern, matchesBinding);
  return directMatch
    || (!hasDirectDiscriminatorEvidence(slice, remainder)
      && resolvedResourceMatchesSliceTargetProfile(resolved, slice, referencePath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
