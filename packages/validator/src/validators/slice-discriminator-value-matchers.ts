import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath, valueCanIdentifyFixedSlice, valuesMatch } from './slice-utils.js';
import {
  canPatternCoreIdentifyCodingSlice,
  matchWholeElementChildConstraints,
} from './slice-discriminator-complex-matchers.js';
import {
  extensionProfileUrlMatches,
  getChildConstraint,
  getChildConstraints,
  isProhibitedEmptyWholeElementSlice,
  matchChildBindingDiscriminator,
  normalizeChildConstraintPath,
} from './slice-discriminator-constraints.js';

type PatternMatcher = (value: unknown, pattern: unknown) => boolean;
type BindingMatcher = (value: unknown, codes: Set<string>) => boolean;

export function matchValueDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  path: string,
  matchesPattern: PatternMatcher,
  matchesBinding: BindingMatcher,
): boolean {
  if (isProhibitedEmptyWholeElementSlice(slice, 'value', path)) return false;
  const value = getValueAtPath(element, path);
  const childPath = normalizeChildConstraintPath(path);
  if (!path || path === '$this') {
    if (slice.fixed !== undefined) return valueCanIdentifyFixedSlice(value, slice.fixed, slice.fixedKind);
    if (slice.pattern !== undefined) return matchesPattern(value, slice.pattern);
    const childMatch = matchWholeElementChildConstraints(value, slice, matchesPattern);
    if (childMatch !== null) return childMatch;
  }
  if (path && path !== '$this') {
    const fixedCandidates = slice.childFixed ? getChildConstraints(slice.childFixed, childPath) : [];
    if (fixedCandidates.length > 0) return anyValueMatchesAnyConstraint(value, fixedCandidates, valuesMatch);
    const patternCandidates = slice.childPatterns ? getChildConstraints(slice.childPatterns, childPath) : [];
    if (patternCandidates.length > 0) return anyValueMatchesAnyConstraint(value, patternCandidates, matchesPattern);
    const binding = matchChildBindingDiscriminator(slice, childPath, value, matchesBinding);
    if (binding !== null) return binding;
    if (path === 'url' && extensionProfileUrlMatches(value, slice)) return true;
  }
  const fixedValue = slice.fixed ? getValueAtPath(slice.fixed, path) : null;
  if (fixedValue !== null && fixedValue !== undefined) return valuesMatch(value, fixedValue);
  const patternValue = slice.pattern ? getValueAtPath(slice.pattern, path) : null;
  if (patternValue !== null && patternValue !== undefined) return matchesPattern(value, patternValue);
  return slice.bindingCodes?.size ? matchesBinding(value, slice.bindingCodes) : false;
}

/**
 * Discriminator paths evaluate with FHIRPath collection semantics: crossing a
 * repeating element (`code.coding.code`) yields every value, and a resliced
 * repeat contributes one discriminating constraint per sub-slice. The slice is
 * identified when any instance value satisfies any of those constraints.
 */
function anyValueMatchesAnyConstraint(
  value: unknown,
  constraints: unknown[],
  matches: (value: unknown, constraint: unknown) => boolean,
): boolean {
  const collection = Array.isArray(value) ? value : [value];
  return constraints.some(constraint =>
    matches(value, constraint) || collection.some(item => matches(item, constraint))
  );
}

export function matchPatternDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  path: string,
  matchesPattern: PatternMatcher,
  matchesBinding: BindingMatcher,
  allSlices?: SliceDefinition[],
): boolean {
  if (isProhibitedEmptyWholeElementSlice(slice, 'pattern', path)) return false;
  const value = getValueAtPath(element, path);
  const childPath = normalizeChildConstraintPath(path);
  if ((!path || path === '$this') && !slice.pattern && !slice.fixed) {
    if (matchWholeElementChildConstraints(value, slice, matchesPattern) === false) return false;
  }
  if (path && path !== '$this') {
    const pattern = slice.childPatterns && getChildConstraint(slice.childPatterns, childPath);
    if (pattern !== undefined) return matchesPattern(value, pattern);
    const fixed = slice.childFixed && getChildConstraint(slice.childFixed, childPath);
    if (fixed !== undefined) return matchesPattern(value, fixed);
    const binding = matchChildBindingDiscriminator(slice, childPath, value, matchesBinding);
    if (binding !== null) return binding;
  }
  if (slice.pattern) {
    const pattern = path === '$this' || !path ? slice.pattern : getValueAtPath(slice.pattern, path);
    if (pattern !== undefined && pattern !== null) {
      return matchesPattern(value, pattern)
        || canPatternCoreIdentifyCodingSlice(value, slice, pattern, allSlices, matchesPattern);
    }
  }
  if (slice.bindingCodes?.size) return matchesBinding(value, slice.bindingCodes);
  return !slice.bindingValueSet;
}
