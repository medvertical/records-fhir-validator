/**
 * Slice Discriminator Matcher
 *
 * Extracted from SlicingValidator. Handles the 5 discriminator types
 * (value, pattern, type, profile, exists) plus resolve() path support.
 */

import type { SlicingDiscriminator } from '../core/structure-definition-types';
import type { SliceDefinition } from './slice-types';
import { getValueAtPath, valuesMatch, inferType } from './slice-utils';
import { logger } from '../logger';

export type ReferenceResolverFn = ((ref: string) => any | null) | null;

export function matchDiscriminator(
  element: any,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
  referenceResolver: ReferenceResolverFn,
  matchesPatternFn: (value: any, pattern: any) => boolean,
  codingMatchesBindingCodesFn: (value: any, codes: Set<string>) => boolean,
  allSlices?: SliceDefinition[],
): boolean {
  let path = discriminator.path;

  if (path.startsWith('resolve()')) {
    const resolvedElement = resolveDiscriminatorPath(element, path, referenceResolver);
    if (resolvedElement === null) return false;

    const remainder = path.slice('resolve()'.length).replace(/^\./, '');
    if (discriminator.type === 'type') {
      return matchResolvedTypeDiscriminator(resolvedElement, slice, remainder, allSlices);
    }
    if (remainder === '' || remainder === '$this') {
      return matchProfileDiscriminator({ $this: resolvedElement }, slice, '$this', referenceResolver, allSlices);
    }
    const ofTypeMatch = remainder.match(/^ofType\(([^)]+)\)$/);
    if (ofTypeMatch) return resolvedElement?.resourceType === ofTypeMatch[1];
    const conformsToMatch = remainder.match(/^conformsTo\('([^']+)'\)$/);
    if (conformsToMatch) {
      return toProfileArray(resolvedElement?.meta?.profile).includes(conformsToMatch[1]);
    }
    return matchValueDiscriminator(element, slice, remainder, matchesPatternFn);
  }

  switch (discriminator.type) {
    case 'value': return matchValueDiscriminator(element, slice, path, matchesPatternFn);
    case 'pattern': return matchPatternDiscriminator(element, slice, path, matchesPatternFn, codingMatchesBindingCodesFn);
    case 'type': return matchTypeDiscriminator(element, slice, path);
    case 'profile': return matchProfileDiscriminator(element, slice, path, referenceResolver, allSlices);
    case 'exists': return matchExistsDiscriminator(element, path);
    default:
      logger.warn(`[SlicingValidator] Unsupported discriminator type: ${discriminator.type}`);
      return false;
  }
}

function matchResolvedTypeDiscriminator(
  resolvedElement: any,
  slice: SliceDefinition,
  remainder: string,
  allSlices?: SliceDefinition[],
): boolean {
  if (!resolvedElement || typeof resolvedElement !== 'object') return false;

  if (remainder) {
    const ofTypeMatch = remainder.match(/^ofType\(([^)]+)\)$/);
    if (ofTypeMatch) return resolvedElement.resourceType === ofTypeMatch[1];
  }

  const typeSpecs = getTypeSpecsForDiscriminator(slice, '$this');
  if (typeSpecs.length === 0) return false;

  const targetProfiles = typeSpecs.flatMap(spec => spec.targetProfile ?? []);
  if (targetProfiles.length > 0) {
    const profiles = toProfileArray(resolvedElement.meta?.profile);
    if (profiles.some(profile => targetProfiles.includes(profile))) return true;

    const allowedTargetTypes = new Set(targetProfiles.map(profileToResourceType).filter(Boolean));
    if (
      typeof resolvedElement.resourceType === 'string' &&
      allowedTargetTypes.has(resolvedElement.resourceType) &&
      targetProfilesAreDistinguishing(slice, allSlices)
    ) {
      return true;
    }
  }

  const allowedTypeCodes = typeSpecs.map(spec => spec.code).filter(Boolean);
  return typeof resolvedElement.resourceType === 'string' &&
    allowedTypeCodes.includes(resolvedElement.resourceType);
}

function matchValueDiscriminator(
  element: any,
  slice: SliceDefinition,
  path: string,
  matchesPatternFn: (value: any, pattern: any) => boolean,
): boolean {
  const elementValue = getValueAtPath(element, path);
  const childPath = normalizeChildConstraintPath(path);

  if (!path || path === '$this') {
    if (slice.fixed !== undefined) return valuesMatch(elementValue, slice.fixed);
    if (slice.pattern !== undefined) return matchesPatternFn(elementValue, slice.pattern);
    const childConstraintMatch = matchWholeElementChildConstraints(elementValue, slice, matchesPatternFn);
    if (childConstraintMatch !== null) return childConstraintMatch;
  }

  if (path && path !== '$this') {
    if (slice.childFixed) {
      const childFixed = slice.childFixed.get(childPath);
      if (childFixed !== undefined) return valuesMatch(elementValue, childFixed);
    }
    if (slice.childPatterns) {
      const childPattern = slice.childPatterns.get(childPath);
      if (childPattern !== undefined) return matchesPatternFn(elementValue, childPattern);
    }
  }

  const sliceValue = slice.fixed ? getValueAtPath(slice.fixed, path) : null;
  if (sliceValue !== null && sliceValue !== undefined) return valuesMatch(elementValue, sliceValue);

  const patternValue = slice.pattern ? getValueAtPath(slice.pattern, path) : null;
  if (patternValue !== null && patternValue !== undefined) return matchesPatternFn(elementValue, patternValue);

  return false;
}

function normalizeChildConstraintPath(path: string): string {
  return path.startsWith('$this.')
    ? path.slice('$this.'.length)
    : path;
}

function matchPatternDiscriminator(
  element: any, slice: SliceDefinition, path: string,
  matchesPatternFn: (value: any, pattern: any) => boolean,
  codingMatchesBindingCodesFn: (value: any, codes: Set<string>) => boolean,
): boolean {
  const elementValue = getValueAtPath(element, path);
  const childPath = normalizeChildConstraintPath(path);

  if ((!path || path === '$this') && !slice.pattern && !slice.fixed) {
    const childConstraintMatch = matchWholeElementChildConstraints(elementValue, slice, matchesPatternFn);
    if (childConstraintMatch === false) return false;
  }

  if (path && path !== '$this') {
    if (slice.childPatterns) {
      const childPattern = slice.childPatterns.get(childPath);
      if (childPattern !== undefined) return matchesPatternFn(elementValue, childPattern);
    }
    if (slice.childFixed) {
      const childFixed = slice.childFixed.get(childPath);
      if (childFixed !== undefined) return matchesPatternFn(elementValue, childFixed);
    }
  }

  if (slice.pattern) {
    const patternValue = (path === '$this' || !path) ? slice.pattern : getValueAtPath(slice.pattern, path);
    if (patternValue !== undefined && patternValue !== null) return matchesPatternFn(elementValue, patternValue);
  }

  if (slice.bindingCodes && slice.bindingCodes.size > 0) {
    return codingMatchesBindingCodesFn(elementValue, slice.bindingCodes);
  }

  return true;
}

function matchWholeElementChildConstraints(
  elementValue: any,
  slice: SliceDefinition,
  matchesPatternFn: (value: any, pattern: any) => boolean,
): boolean | null {
  let hasConstraint = false;

  if (slice.childPatterns) {
    for (const [childPath, childPattern] of slice.childPatterns) {
      hasConstraint = true;
      if (!matchesPatternFn(getValueAtPath(elementValue, childPath), childPattern)) {
        return false;
      }
    }
  }

  if (slice.childFixed) {
    for (const [childPath, childFixed] of slice.childFixed) {
      hasConstraint = true;
      if (!matchesPatternFn(getValueAtPath(elementValue, childPath), childFixed)) {
        return false;
      }
    }
  }

  return hasConstraint ? true : null;
}

function matchTypeDiscriminator(element: any, slice: SliceDefinition, path: string): boolean {
  const value = getValueAtPath(element, path);
  if (value === null || value === undefined) return false;

  const valueType = inferType(value);
  const typeSpecs = getTypeSpecsForDiscriminator(slice, path);

  return typeSpecs.some(t => typeCodeMatchesValue(t.code, valueType, value));
}

function typeCodeMatchesValue(expectedType: string | undefined, inferredType: string, value: any): boolean {
  if (!expectedType) return false;
  if (expectedType === inferredType) return true;

  if (value && typeof value === 'object' && typeof value.resourceType === 'string') {
    return expectedType === value.resourceType;
  }

  if (isExtensionOnlyObject(value) && !PRIMITIVE_TYPE_CODES.has(expectedType)) {
    return true;
  }

  if (typeof value !== 'string') return false;
  switch (expectedType) {
    case 'date':
      return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
    case 'dateTime':
      return /^\d{4}(-\d{2}(-\d{2}(T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?)?)?)?$/.test(value);
    case 'instant':
      return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value);
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/.test(value);
    case 'string':
    case 'code':
    case 'markdown':
    case 'id':
    case 'uri':
    case 'url':
    case 'canonical':
    case 'oid':
    case 'uuid':
      return inferredType === 'string';
    default:
      return false;
  }
}

const PRIMITIVE_TYPE_CODES = new Set<string>([
  'string', 'code', 'markdown', 'id', 'uri', 'url', 'canonical', 'oid', 'uuid', 'xhtml',
  'integer', 'unsignedInt', 'positiveInt', 'integer64',
  'decimal', 'boolean',
  'date', 'dateTime', 'instant', 'time',
  'base64Binary',
]);

function isExtensionOnlyObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => k === 'extension' || k === 'id');
}

function matchProfileDiscriminator(
  element: any, slice: SliceDefinition, path: string,
  referenceResolver: ReferenceResolverFn,
  allSlices?: SliceDefinition[],
): boolean {
  const typeSpecs = getTypeSpecsForDiscriminator(slice, path);
  if (typeSpecs.length === 0) return false;

  const value = getValueAtPath(element, path);
  if (!value || typeof value !== 'object') return false;

  const requiredProfiles: string[] = [];
  const allowedTypeCodes: string[] = [];
  for (const typeSpec of typeSpecs) {
    if (typeSpec.code) allowedTypeCodes.push(typeSpec.code);
    if (typeSpec.profile && typeSpec.profile.length > 0) requiredProfiles.push(...typeSpec.profile);
  }

  // 1. Exact meta.profile match (strongest signal)
  if (value.meta && value.meta.profile && requiredProfiles.length > 0) {
    const profiles = toProfileArray(value.meta.profile);
    if (profiles.some(p => requiredProfiles.includes(p))) return true;
  }

  // 2. Reference resolution for profile matching
  if (typeof value.reference === 'string' && referenceResolver && requiredProfiles.length > 0) {
    try {
      const referenced = referenceResolver(value.reference);
      if (referenced?.meta?.profile) {
        const profiles = toProfileArray(referenced.meta.profile);
        if (profiles.some(p => requiredProfiles.includes(p))) return true;
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.debug(`[SlicingValidator] Reference resolver threw: ${err.message}`);
    }
  }

  // 3. Fallback: match by resourceType when different slices have distinct
  // type codes so type alone unambiguously identifies the slice. When all
  // slices share the same type code set (or there's only one slice), type
  // matching is insufficient — the FHIR profile discriminator requires
  // conformsTo semantics that we can't fully check here, so we conservatively
  // return false to avoid false-positive matches.
  if (typeof value.resourceType === 'string' && allowedTypeCodes.length > 0) {
    if (allowedTypeCodes.includes(value.resourceType) &&
        typeCodesAreDistinguishing(slice, path, allSlices)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether the type codes on this slice are sufficient to distinguish it
 * from other slices. Returns true when at least one other slice exists AND
 * this slice's type codes don't fully overlap with every other slice's codes.
 *
 * When there's only one slice, type matching alone can't confirm conformance
 * to the required profile (the FHIR spec requires conformsTo), so we return
 * false to avoid false-positive slice matches.
 */
function typeCodesAreDistinguishing(
  currentSlice: SliceDefinition,
  path: string,
  allSlices?: SliceDefinition[],
): boolean {
  if (!allSlices || allSlices.length <= 1) return false;

  const currentCodes = collectTypeCodes(currentSlice, path);
  if (currentCodes.size === 0) return false;

  // Check if any other slice has a completely disjoint set of type codes.
  // If so, type-based matching can disambiguate slices.
  for (const otherSlice of allSlices) {
    if (otherSlice.sliceName === currentSlice.sliceName) continue;
    const otherCodes = collectTypeCodes(otherSlice, path);
    if (otherCodes.size === 0) continue;

    // If there's any overlap between this slice and another, type codes
    // alone can't distinguish them — need real conformsTo.
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

function getTypeSpecsForDiscriminator(
  slice: SliceDefinition,
  path: string,
): Array<{ code: string; profile?: string[]; targetProfile?: string[] }> {
  // In real snapshots, sliced BackboneElements often carry the generic root
  // type on the slice itself while the discriminator-specific type/profile is
  // defined on a child, e.g. Bundle.entry:composition.resource. For
  // discriminator path "resource", that child constraint is authoritative.
  if (slice.childTypes && path && path !== '$this') {
    const childSpecs = slice.childTypes.get(path);
    if (childSpecs && childSpecs.length > 0) return childSpecs;
  }
  return slice.type ?? [];
}

function targetProfilesAreDistinguishing(
  currentSlice: SliceDefinition,
  allSlices?: SliceDefinition[],
): boolean {
  if (!allSlices || allSlices.length <= 1) return false;

  const currentProfiles = collectTargetProfiles(currentSlice);
  if (currentProfiles.size === 0) return false;

  for (const otherSlice of allSlices) {
    if (otherSlice.sliceName === currentSlice.sliceName) continue;
    const otherProfiles = collectTargetProfiles(otherSlice);
    if (otherProfiles.size === 0) continue;
    for (const profile of currentProfiles) {
      if (otherProfiles.has(profile)) return false;
    }
  }

  return true;
}

function collectTargetProfiles(slice: SliceDefinition): Set<string> {
  const profiles = new Set<string>();
  for (const spec of getTypeSpecsForDiscriminator(slice, '$this')) {
    for (const profile of spec.targetProfile ?? []) profiles.add(profile);
  }
  return profiles;
}

function profileToResourceType(profileUrl: string): string | null {
  const clean = profileUrl.split('|')[0] ?? profileUrl;
  const tail = clean.split('/').pop();
  if (!tail) return null;
  return tail.includes('-') ? null : tail;
}

function matchExistsDiscriminator(element: any, path: string): boolean {
  const value = getValueAtPath(element, path);
  return value !== null && value !== undefined;
}

function resolveDiscriminatorPath(element: any, _path: string, resolver: ReferenceResolverFn): any | null {
  const refString = typeof element === 'object' && element?.reference
    ? element.reference
    : typeof element === 'string' ? element : null;

  if (!refString || !resolver) return null;
  try { return resolver(refString) ?? null; } catch { return null; }
}

function toProfileArray(profile: unknown): string[] {
  if (Array.isArray(profile)) return profile.filter((p): p is string => typeof p === 'string');
  if (typeof profile === 'string') return [profile];
  return [];
}
