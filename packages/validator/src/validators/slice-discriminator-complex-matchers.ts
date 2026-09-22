import { getValueAtPath } from './slice-utils.js';
import type { SliceDefinition } from './slice-types.js';
import { getTypeSpecsForDiscriminator } from './slice-type-discriminator.js';
import {
  profileListContains,
  toProfileArray,
  type ReferenceResolverFn,
} from './slice-profile-discriminator-matcher.js';

export function resolvedResourceMatchesSliceTargetProfile(
  resolvedElement: unknown,
  slice: SliceDefinition,
  typeSpecPath = '$this',
): boolean {
  if (!isRecord(resolvedElement)) return false;
  const targetProfiles = getTypeSpecsForDiscriminator(slice, typeSpecPath)
    .flatMap(spec => spec.targetProfile ?? []);
  if (targetProfiles.length === 0) return false;
  const meta = isRecord(resolvedElement.meta) ? resolvedElement.meta : null;
  return toProfileArray(meta?.profile)
    .some(profile => profileListContains(targetProfiles, profile));
}

export function canPatternCoreIdentifyCodingSlice(
  elementValue: unknown,
  slice: SliceDefinition,
  patternValue: unknown,
  allSlices: SliceDefinition[] | undefined,
  matchesPatternFn: (value: unknown, pattern: unknown) => boolean,
): boolean {
  if (slice.patternKind !== 'patternCoding') return false;
  if (!codingIdentityMatchesPattern(elementValue, patternValue)) return false;

  const candidateSlices = allSlices?.length ? allSlices : [slice];
  const matchingIdentitySlices = candidateSlices.filter(candidate =>
    candidate.patternKind === 'patternCoding' &&
    candidate.pattern !== undefined &&
    codingIdentityMatchesPattern(elementValue, candidate.pattern)
  );
  if (matchingIdentitySlices.length !== 1 || matchingIdentitySlices[0] !== slice) return false;
  return !candidateSlices.some(candidate =>
    candidate !== slice &&
    candidate.pattern !== undefined &&
    matchesPatternFn(elementValue, candidate.pattern)
  );
}

function codingIdentityMatchesPattern(elementValue: unknown, patternValue: unknown): boolean {
  if (!isRecord(elementValue) || !isRecord(patternValue)) return false;
  if (typeof patternValue.system !== 'string' || typeof patternValue.code !== 'string') return false;
  return elementValue.system === patternValue.system && elementValue.code === patternValue.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { matchWholeElementChildConstraints } from './slice-discriminator-constraints.js';

export function matchExistsDiscriminator(element: unknown, path: string): boolean {
  const value = getValueAtPath(element, path);
  return value !== null && value !== undefined &&
    (!Array.isArray(value) || value.length > 0);
}

export function resolveDiscriminatorPath(
  element: unknown,
  _path: string,
  resolver: ReferenceResolverFn,
): unknown | null {
  const refString = isRecord(element) && typeof element.reference === 'string'
    ? element.reference
    : typeof element === 'string' ? element : null;
  if (!refString || !resolver) return null;
  try { return resolver(refString) ?? null; } catch { return null; }
}
