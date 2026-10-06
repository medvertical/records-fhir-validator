import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath } from './slice-utils.js';
import {
  getTypeSpecsForDiscriminator,
  stripCanonicalVersion,
} from './slice-type-discriminator.js';
import { matchWholeElementChildConstraints } from './slice-discriminator-constraints.js';
import { declaredProfileAncestryContains } from './slice-profile-ancestry.js';
import { sliceTypedByProfile } from './slice-profile-types.js';
import { datatypeConformingSlices } from './slice-datatype-conformance.js';
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
  // A profile discriminator on a primitive below the slice (eu.imaging slices
  // ImagingStudy.identifier by profile at `system`) cannot be read off the
  // primitive; the slice's datatype profile decides through its constraints.
  if (path !== '$this' && matchesPattern && values.every(isPrimitiveValue)) {
    const conforms = matchWholeElementChildConstraints(element, slice, matchesPattern);
    if (conforms !== null) return conforms;
  }

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
  // Validation against the slice's profiles decides where it could, as in the reference validator.
  const validated = slice.validatedProfileConformance?.(value, requiredProfiles);
  if (validated !== undefined) return validated;
  const conforming = datatypeConformingSlices(value);
  if (conforming) return conforming.has(slice.sliceName);

  const meta = isObjectRecord(value.meta) ? value.meta : null;
  if (meta && requiredProfiles.length > 0) {
    const profiles = toProfileArray(meta.profile);
    if (profiles.some(profile => profileListContains(requiredProfiles, profile))) return true;
    // A declared profile DERIVED from the required one still conforms to it
    // (e.g. MHD Comprehensive.Folder vs the slice's Minimal.Folder).
    if (declaredProfileAncestryContains(value, requiredProfiles)) return true;
  }

  if (namesBaseDefinitionOf(requiredProfiles, value.resourceType)) return true;
  if (typeof value.reference === 'string' && referenceResolver && requiredProfiles.length > 0) {
    try {
      const referenced = referenceResolver(value.reference);
      if (isObjectRecord(referenced) && namesBaseDefinitionOf(requiredProfiles, referenced.resourceType)) return true;
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
  if (sliceTypedByProfile(value) === slice.sliceName) return true;

  // Datatype values (e.g. UsageContext) carry no meta.profile, so membership
  // in a datatype profile is decided by the profile's own pattern/fixed
  // constraints, merged into the slice's child maps at extraction time.
  if (matchesPattern && typeof value.resourceType !== 'string') {
    const childMatch = matchWholeElementChildConstraints(value, slice, matchesPattern);
    if (childMatch !== null) return childMatch;
  }

  return false;
}

const BASE_DEFINITION = /^http:\/\/hl7\.org\/fhir\/StructureDefinition\/([A-Z][A-Za-z]+)$/;

/** Every resource conforms to its own base definition, declared or not (CH eMed author:device). */
function namesBaseDefinitionOf(requiredProfiles: string[], resourceType: unknown): boolean {
  return typeof resourceType === 'string'
    && requiredProfiles.some(profile => profile.split('|')[0].match(BASE_DEFINITION)?.[1] === resourceType);
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

function isPrimitiveValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
