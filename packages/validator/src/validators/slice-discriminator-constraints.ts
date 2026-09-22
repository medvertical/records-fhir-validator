import type { SlicingDiscriminator } from '../core/structure-definition-types.js';
import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath, valuesMatch } from './slice-utils.js';
import { getTypeSpecsForDiscriminator, stripCanonicalVersion } from './slice-type-discriminator.js';

export function sliceHasDiscriminatorEvidence(
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
): boolean {
  const path = normalizeDiscriminatorPath(discriminator.path);
  const childPath = normalizeChildConstraintPath(path);
  if (isProhibitedEmptyWholeElementSlice(slice, discriminator.type, path)) return true;
  if (discriminator.type === 'type') return getTypeSpecsForDiscriminator(slice, path).length > 0;
  if (discriminator.type === 'profile') {
    return getTypeSpecsForDiscriminator(slice, path).some(spec => (
      (spec.profile?.length ?? 0) > 0 || (spec.targetProfile?.length ?? 0) > 0
    ));
  }
  if (discriminator.type === 'exists') {
    return candidateChildConstraintPaths(childPath).some(candidate => (
      slice.childMin?.has(candidate)
      || slice.childFixed?.has(candidate)
      || slice.childPatterns?.has(candidate)
    ));
  }
  if (path === 'url' && getExtensionProfileUrls(slice).length > 0) return true;
  if (hasResolvedTargetProfileEvidence(slice, discriminator.type, path)) return true;
  return hasDirectDiscriminatorEvidence(slice, path);
}

/**
 * A `resolve()` discriminator names a property of the *referenced* resource, so
 * a slice cannot fix that value on itself — it identifies its members by the
 * target profile they must conform to. Counting `targetProfile` as evidence is
 * what lets `matchResolvedDiscriminator` reach its declared-profile fallback;
 * without it such slicing is never evaluated at all.
 */
function hasResolvedTargetProfileEvidence(
  slice: SliceDefinition,
  discriminatorType: string,
  path: string,
): boolean {
  if (discriminatorType !== 'value' && discriminatorType !== 'pattern') return false;
  if (!path.startsWith('resolve()')) return false;
  return getTypeSpecsForDiscriminator(slice, '$this')
    .some(spec => (spec.targetProfile?.length ?? 0) > 0);
}

export function normalizeDiscriminatorPath(path: string): string {
  return path.startsWith('$this.resolve()')
    ? `resolve()${path.slice('$this.resolve()'.length)}`
    : path;
}

export function normalizeChildConstraintPath(path: string): string {
  return path.startsWith('$this.') ? path.slice('$this.'.length) : path;
}

export function candidateChildConstraintPaths(childPath: string): string[] {
  const paths: string[] = [];
  let current = childPath;
  while (current) {
    paths.push(current);
    const dot = current.lastIndexOf('.');
    if (dot === -1) break;
    current = current.slice(0, dot);
  }
  return paths;
}

export function getChildConstraint(map: Map<string, unknown>, requestedPath: string): unknown | undefined {
  const matches = getChildConstraints(map, requestedPath);
  if (matches.length === 0) return undefined;
  return matches.every(value => valuesMatch(value, matches[0])) ? matches[0] : undefined;
}

/**
 * All constraint values whose key resolves to the requested path once slice
 * labels are stripped. A discriminator path that crosses a resliced repeating
 * element (e.g. `code.coding.code` where `coding` has sub-slices each fixing
 * `code`) legitimately yields several distinct values — the union identifies
 * the slice, so conflicts must not collapse to "no constraint".
 */
export function getChildConstraints(map: Map<string, unknown>, requestedPath: string): unknown[] {
  if (map.has(requestedPath)) return [map.get(requestedPath)];
  return Array.from(map.entries())
    .filter(([candidate]) => stripSliceLabels(candidate) === requestedPath)
    .map(([, value]) => value);
}

export function hasDirectDiscriminatorEvidence(slice: SliceDefinition, path: string): boolean {
  for (const candidate of candidateChildConstraintPaths(normalizeChildConstraintPath(path))) {
    if (slice.childFixed && getChildConstraints(slice.childFixed, candidate).length > 0) return true;
    if (slice.childPatterns && getChildConstraints(slice.childPatterns, candidate).length > 0) return true;
    if (slice.childBindingCodes?.has(candidate) || slice.childBindingValueSets?.has(candidate)) return true;
  }
  if (slice.fixed && getValueAtPath(slice.fixed, path) !== undefined) return true;
  if (slice.pattern && getValueAtPath(slice.pattern, path) !== undefined) return true;
  return (slice.bindingCodes?.size ?? 0) > 0 || Boolean(slice.bindingValueSet);
}

export function isProhibitedEmptyWholeElementSlice(
  slice: SliceDefinition,
  discriminatorType: string,
  path: string,
): boolean {
  if (slice.max !== '0') return false;
  if (discriminatorType !== 'pattern' && discriminatorType !== 'value') return false;
  if (path && path !== '$this') return false;
  return !hasMeaningfulValue(slice.pattern)
    && !hasMeaningfulValue(slice.fixed)
    && (slice.childPatterns?.size ?? 0) === 0
    && (slice.childFixed?.size ?? 0) === 0
    && (slice.bindingCodes?.size ?? 0) === 0
    && !slice.bindingValueSet;
}

export function extensionProfileUrlMatches(value: unknown, slice: SliceDefinition): boolean {
  return typeof value === 'string'
    && getExtensionProfileUrls(slice).some(url => stripCanonicalVersion(value) === stripCanonicalVersion(url));
}

export function matchChildBindingDiscriminator(
  slice: SliceDefinition,
  childPath: string,
  elementValue: unknown,
  matchesCodes: (value: unknown, codes: Set<string>) => boolean,
): boolean | null {
  for (const path of candidateChildConstraintPaths(childPath)) {
    const codes = slice.childBindingCodes?.get(path);
    if (codes?.size) return matchesCodes(elementValue, codes);
    if (slice.childBindingValueSets?.has(path)) return false;
  }
  return null;
}

export function matchWholeElementChildConstraints(
  elementValue: unknown,
  slice: SliceDefinition,
  matchesPatternFn: (value: unknown, pattern: unknown) => boolean,
): boolean | null {
  let hasConstraint = false;
  for (const [childPath, childPattern] of slice.childPatterns ?? []) {
    hasConstraint = true;
    if (!matchesPatternFn(getChildConstraintValue(elementValue, childPath), childPattern)) return false;
  }
  for (const [childPath, childFixed] of slice.childFixed ?? []) {
    hasConstraint = true;
    if (!matchesPatternFn(getChildConstraintValue(elementValue, childPath), childFixed)) return false;
  }
  return hasConstraint ? true : null;
}

/**
 * Child constraint keys can carry slice labels from the defining profile
 * (e.g. "value[x]:valueCodeableConcept"), which never appear in instance
 * JSON. Resolve those through the concrete choice property they name.
 */
function getChildConstraintValue(elementValue: unknown, childPath: string): unknown {
  const direct = getValueAtPath(elementValue, childPath);
  if (direct !== undefined && direct !== null) return direct;

  const normalized = childPath
    .split('.')
    .map(segment => normalizeSliceLabeledSegment(segment))
    .join('.');
  return normalized === childPath ? direct : getValueAtPath(elementValue, normalized);
}

function normalizeSliceLabeledSegment(segment: string): string {
  const labelStart = segment.indexOf(':');
  if (labelStart === -1) return segment;
  const base = segment.slice(0, labelStart);
  const label = segment.slice(labelStart + 1);
  if (base.endsWith('[x]') && label.startsWith(base.slice(0, -3))) return label;
  return base;
}

function getExtensionProfileUrls(slice: SliceDefinition): string[] {
  return (slice.type ?? [])
    .filter(type => type.code === 'Extension')
    .flatMap(type => type.profile ?? []);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function stripSliceLabels(path: string): string {
  return path.split('.').map(segment => segment.split(':')[0]).join('.');
}
