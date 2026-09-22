import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath } from './slice-utils.js';
import {
  getTypeSpecsForDiscriminator,
  stripCanonicalVersion,
} from './slice-type-discriminator.js';
import { matchWholeElementChildConstraints } from './slice-discriminator-constraints.js';
import { declaredProfileAncestryContains } from './slice-profile-ancestry.js';
import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

export type ReferenceResolverFn = ((ref: string) => unknown | null) | null;
type PatternMatcherFn = ((value: unknown, pattern: unknown) => boolean) | null;

export function matchProfileDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  path: string,
  referenceResolver: ReferenceResolverFn,
  allSlices?: SliceDefinition[],
  matchesPattern?: PatternMatcherFn,
  // After `item.resolve()` the value is read on the resolved target while the
  // identifying type constraint still sits on `item` in the slice definition.
  typeSpecPath: string = path,
): boolean {
  const typeSpecs = getTypeSpecsForDiscriminator(slice, typeSpecPath);
  if (typeSpecs.length === 0) return false;

  const value = getValueAtPath(element, path);
  const values = Array.isArray(value) ? value : [value];

  const requiredProfiles: string[] = [];
  const allowedTypeCodes: string[] = [];
  for (const typeSpec of typeSpecs) {
    if (typeSpec.code) allowedTypeCodes.push(typeSpec.code);
    if (typeSpec.profile && typeSpec.profile.length > 0) requiredProfiles.push(...typeSpec.profile);
    if (typeSpec.targetProfile && typeSpec.targetProfile.length > 0) requiredProfiles.push(...typeSpec.targetProfile);
  }

  return values.some(candidate => matchProfileValue(
    candidate,
    requiredProfiles,
    allowedTypeCodes,
    slice,
    typeSpecPath,
    referenceResolver,
    allSlices,
    matchesPattern ?? null,
  ));
}

function matchProfileValue(
  value: unknown,
  requiredProfiles: string[],
  allowedTypeCodes: string[],
  slice: SliceDefinition,
  typeSpecPath: string,
  referenceResolver: ReferenceResolverFn,
  allSlices?: SliceDefinition[],
  matchesPattern: PatternMatcherFn = null,
): boolean {
  if (!isObjectRecord(value)) return false;

  const meta = isObjectRecord(value.meta) ? value.meta : null;
  if (meta && requiredProfiles.length > 0) {
    const profiles = toProfileArray(meta.profile);
    if (profiles.some(profile => profileListContains(requiredProfiles, profile))) return true;
    // A declared profile DERIVED from the required one still conforms to it
    // (e.g. MHD Comprehensive.Folder vs the slice's Minimal.Folder).
    if (declaredProfileAncestryContains(value, requiredProfiles)) return true;
  }

  if (typeof value.reference === 'string' && referenceResolver && requiredProfiles.length > 0) {
    try {
      const referenced = referenceResolver(value.reference);
      const referencedMeta = isObjectRecord(referenced) && isObjectRecord(referenced.meta)
        ? referenced.meta
        : null;
      if (referencedMeta) {
        const profiles = toProfileArray(referencedMeta.profile);
        if (profiles.some(profile => profileListContains(requiredProfiles, profile))) return true;
      }
    } catch (error: unknown) {
      logger.debug(
        '[SlicingValidator] Reference resolver threw',
        validationFailureMetadata(error),
      );
    }
  }

  if (typeof value.resourceType === 'string' && allowedTypeCodes.length > 0) {
    if (allowedTypeCodes.includes(value.resourceType) &&
        typeCodesAreDistinguishing(slice, typeSpecPath, allSlices)) {
      return true;
    }
  }

  // Datatype values (e.g. UsageContext) carry no meta.profile, so membership
  // in a datatype profile is decided by the profile's own pattern/fixed
  // constraints, merged into the slice's child maps at extraction time.
  if (matchesPattern && typeof value.resourceType !== 'string') {
    const childMatch = matchWholeElementChildConstraints(value, slice, matchesPattern);
    if (childMatch !== null) return childMatch;
  }

  return false;
}

function typeCodesAreDistinguishing(
  currentSlice: SliceDefinition,
  path: string,
  allSlices?: SliceDefinition[],
): boolean {
  if (!allSlices || allSlices.length <= 1) return false;

  const currentCodes = collectTypeCodes(currentSlice, path);
  if (currentCodes.size === 0) return false;

  for (const otherSlice of allSlices) {
    if (otherSlice.sliceName === currentSlice.sliceName) continue;
    const otherCodes = collectTypeCodes(otherSlice, path);
    if (otherCodes.size === 0) continue;

    for (const code of currentCodes) {
      if (otherCodes.has(code)) return false;
    }
  }

  return true;
}

function collectTypeCodes(slice: SliceDefinition, path: string): Set<string> {
  const codes = new Set<string>();
  for (const t of getTypeSpecsForDiscriminator(slice, path)) {
    if (t.code) codes.add(t.code);
  }
  return codes;
}

export function toProfileArray(profile: unknown): string[] {
  if (Array.isArray(profile)) return profile.filter((p): p is string => typeof p === 'string');
  if (typeof profile === 'string') return [profile];
  return [];
}

export function profileListContains(profiles: string[], requestedProfile: string): boolean {
  return profiles.some(profile => profilesMatch(profile, requestedProfile));
}

function profilesMatch(left: string, right: string): boolean {
  return left === right || stripCanonicalVersion(left) === stripCanonicalVersion(right);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
