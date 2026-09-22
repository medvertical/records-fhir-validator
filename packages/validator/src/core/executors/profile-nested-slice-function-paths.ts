/**
 * FHIRPath function segments in slicing discriminator paths.
 *
 * Discriminators like `extension('url').value.ofType(boolean)` (Da Vinci PAS
 * careTeam) cannot be evaluated by plain dot-path traversal: the extension
 * URL itself contains dots, and the fixed value that distinguishes the slices
 * lives on a nested extension slice's `value[x]` element rather than at a
 * literal element id concatenation.
 */
import { resolveFhirSegmentValue } from '../fhir-primitive-sidecar.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

const EXTENSION_SEGMENT_RE = /^extension\(\s*(['"])(.+)\1\s*\)$/;
const OF_TYPE_SEGMENT_RE = /^ofType\([^)]+\)$/;

export function hasFunctionPathSegments(path: string): boolean {
  return path.includes('(');
}

/** Split a discriminator path on dots that sit outside parentheses. */
export function splitFunctionPathSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  let parenthesisDepth = 0;
  for (const character of path) {
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === '.' && parenthesisDepth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  segments.push(current);
  return segments.filter(segment => segment.length > 0);
}

/**
 * Evaluate the discriminator path against an instance element. `ofType()` is
 * treated as a pass-through: the caller compares against a typed fixed value,
 * so the cast cannot change the outcome.
 */
export function resolveFunctionPathValue(item: unknown, segments: string[]): unknown {
  let currentValues: unknown[] = [item];
  for (const segment of segments) {
    if (OF_TYPE_SEGMENT_RE.test(segment)) continue;

    const extensionUrl = parseExtensionSegmentUrl(segment);
    const nextValues: unknown[] = [];
    for (const value of currentValues) {
      const resolved = extensionUrl !== null
        ? selectExtensionsByUrl(value, extensionUrl)
        : resolveSegmentWithChoiceFallback(value, segment);
      if (Array.isArray(resolved)) {
        nextValues.push(...resolved.filter(entry => entry !== null && entry !== undefined));
      } else if (resolved !== null && resolved !== undefined) {
        nextValues.push(resolved);
      }
    }
    currentValues = nextValues;
    if (currentValues.length === 0) return undefined;
  }
  return currentValues.length === 1 ? currentValues[0] : currentValues;
}

/**
 * Locate the snapshot element under `parentSlice` that carries the fixed or
 * pattern value the discriminator points at, matching segment-by-segment so
 * slice labels and choice renamings (`value` vs `value[x]`) do not get in
 * the way. Ambiguous matches return undefined — the caller then treats the
 * discriminator as unevaluable rather than guessing.
 */
export function findFunctionPathConstraint(
  parentSlice: ElementDefinition,
  segments: string[],
  structureDef: StructureDefinition,
): ElementDefinition | undefined {
  const parentId = parentSlice.id;
  if (!parentId) return undefined;

  const expectedSegments = segments.filter(segment => !OF_TYPE_SEGMENT_RE.test(segment));
  const elements = structureDef.snapshot?.element ?? [];
  const matches = elements.filter(element =>
    typeof element.id === 'string' &&
    element.id.startsWith(`${parentId}.`) &&
    candidateSegmentsMatch(
      element.id.substring(parentId.length + 1).split('.'),
      expectedSegments,
      parentId,
      elements,
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function candidateSegmentsMatch(
  candidateSegments: string[],
  expectedSegments: string[],
  parentId: string,
  elements: ElementDefinition[],
): boolean {
  if (candidateSegments.length !== expectedSegments.length) return false;

  let candidatePrefix = parentId;
  for (let index = 0; index < expectedSegments.length; index += 1) {
    const candidateSegment = candidateSegments[index];
    candidatePrefix = `${candidatePrefix}.${candidateSegment}`;
    const candidateName = candidateSegment.split(':')[0];
    const expectedSegment = expectedSegments[index];

    const extensionUrl = parseExtensionSegmentUrl(expectedSegment);
    if (extensionUrl !== null) {
      if (candidateName !== 'extension' && candidateName !== 'modifierExtension') return false;
      if (!extensionElementMatchesUrl(candidatePrefix, extensionUrl, elements)) return false;
      continue;
    }
    if (candidateName !== expectedSegment && candidateName !== `${expectedSegment}[x]`) return false;
  }
  return true;
}

function extensionElementMatchesUrl(
  extensionElementId: string,
  url: string,
  elements: ElementDefinition[],
): boolean {
  const extensionElement = elements.find(element => element.id === extensionElementId);
  const profileMatches = extensionElement?.type?.some(type =>
    Array.isArray(type.profile) &&
    type.profile.some(profile => profile.split('|')[0] === url),
  );
  if (profileMatches) return true;

  const urlChild = elements.find(element => element.id === `${extensionElementId}.url`);
  return typeof urlChild?.fixedUri === 'string' && urlChild.fixedUri === url;
}

function parseExtensionSegmentUrl(segment: string): string | null {
  return segment.match(EXTENSION_SEGMENT_RE)?.[2] ?? null;
}

function selectExtensionsByUrl(value: unknown, url: string): unknown[] {
  if (!isObjectRecord(value) || !Array.isArray(value.extension)) return [];
  return value.extension.filter(entry => isObjectRecord(entry) && entry.url === url);
}

function resolveSegmentWithChoiceFallback(value: unknown, segment: string): unknown {
  const direct = resolveFhirSegmentValue(value, segment);
  if (direct !== undefined) return direct;
  return segment.endsWith('[x]')
    ? undefined
    : resolveFhirSegmentValue(value, `${segment}[x]`);
}

export function extractPattern(elementDef: ElementDefinition): unknown {
  for (const [key, value] of Object.entries(elementDef)) {
    if (key.startsWith('pattern')) return value;
  }
  return undefined;
}

export function extractFixed(elementDef: ElementDefinition): unknown {
  for (const [key, value] of Object.entries(elementDef)) {
    if (key.startsWith('fixed')) return value;
  }
  return undefined;
}

/** Pattern containment: every property of `expected` must be present in `actual`. */
export function valueContainsPattern(
  actual: unknown,
  expected: unknown,
  visitedPairs: WeakMap<object, WeakSet<object>>,
): boolean {
  if (expected === undefined || expected === null) return true;
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some(actualItem => valueContainsPattern(actualItem, expected, visitedPairs));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every(expectedItem =>
      actual.some(actualItem => valueContainsPattern(actualItem, expectedItem, visitedPairs)),
    );
  }
  if (isObjectRecord(expected)) {
    if (!isObjectRecord(actual)) return false;
    if (hasVisitedPair(visitedPairs, expected, actual)) return true;
    markVisitedPair(visitedPairs, expected, actual);
    try {
      return Object.entries(expected).every(([key, expectedValue]) =>
        valueContainsPattern(actual[key], expectedValue, visitedPairs),
      );
    } finally {
      visitedPairs.get(expected)?.delete(actual);
    }
  }
  return actual === expected;
}

function hasVisitedPair(
  visitedPairs: WeakMap<object, WeakSet<object>>,
  expected: object,
  actual: object,
): boolean {
  return visitedPairs.get(expected)?.has(actual) ?? false;
}

function markVisitedPair(
  visitedPairs: WeakMap<object, WeakSet<object>>,
  expected: object,
  actual: object,
): void {
  const actualValues = visitedPairs.get(expected) ?? new WeakSet<object>();
  actualValues.add(actual);
  visitedPairs.set(expected, actualValues);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Lives here rather than in the scoping module: the predicate is built purely
// from this module's function-path machinery.
export function buildFunctionPathPredicate(
  discriminatorType: 'value' | 'pattern',
  discriminatorPath: string,
  parentSlice: ElementDefinition,
  structureDef: StructureDefinition,
): ((item: unknown) => boolean) | null {
  const segments = splitFunctionPathSegments(discriminatorPath);
  const constraint = findFunctionPathConstraint(parentSlice, segments, structureDef);
  if (!constraint) return null;

  const expected = discriminatorType === 'pattern'
    ? extractPattern(constraint) ?? extractFixed(constraint)
    : extractFixed(constraint) ?? extractPattern(constraint);
  if (expected === undefined) return null;

  return item => valueContainsPattern(
    resolveFunctionPathValue(item, segments),
    expected,
    new WeakMap<object, WeakSet<object>>(),
  );
}
