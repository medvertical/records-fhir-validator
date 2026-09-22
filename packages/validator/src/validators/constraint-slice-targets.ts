import type { ElementDefinition } from '../core/structure-definition-types.js';
import type { ValidationTarget } from '../business-rules/element-validation-targets.js';
import { getEvaluationContext } from './constraint-path-utils.js';
import {
  extractFixedEntry,
  extractPatternEntry,
  getValueAtPath,
  inferType,
  matchesPattern,
  valueCanIdentifyFixedSlice,
} from './slice-utils.js';

interface SliceMatchContext {
  resource: unknown;
  target: Pick<ValidationTarget, 'fullPath'>;
}

interface SliceChildPattern {
  relativePath: string;
  kind: 'fixed' | 'pattern';
  key: string;
  expected: unknown;
}

/** Compile profile-only lookups for one validation; never retain resource values or another run's definitions. */
export function createSliceDefinitionMatcher(elements: ElementDefinition[]) {
  const slicesById = new Map<string, ElementDefinition[]>();
  for (const element of elements) {
    if (!isElementDefinition(element) || !element.sliceName || typeof element.id !== 'string') continue;
    const siblings = slicesById.get(element.id) ?? [];
    siblings.push(element);
    slicesById.set(element.id, siblings);
  }
  const childrenById = indexSliceChildPatterns(elements, slicesById);
  const ancestorsByElement = new Map<ElementDefinition, ElementDefinition[]>();
  const childPatterns = (slice: ElementDefinition) => slice.id ? childrenById.get(slice.id) ?? [] : [];
  return (value: unknown, element: ElementDefinition, context?: SliceMatchContext): boolean => {
    let ancestors = ancestorsByElement.get(element);
    if (!ancestors) {
      ancestors = [];
      if (!element.id) {
        if (element.sliceName) ancestors.push(element);
      } else {
        for (let end = element.id.indexOf('.'); end >= 0; end = element.id.indexOf('.', end + 1)) {
          ancestors.push(...slicesById.get(element.id.slice(0, end)) ?? []);
        }
        ancestors.push(...slicesById.get(element.id) ?? []);
      }
      ancestorsByElement.set(element, ancestors);
    }
    return matchesSliceAncestors(value, element, ancestors, childPatterns, context);
  };
}

function indexSliceChildPatterns(
  elements: ElementDefinition[],
  slicesById: Map<string, ElementDefinition[]>,
): Map<string, SliceChildPattern[]> {
  const children = new Map<string, SliceChildPattern[]>();
  for (const candidate of elements) {
    if (!isElementDefinition(candidate) || typeof candidate.id !== 'string') continue;
    const parents: Array<{ id: string; relativePath: string }> = [];
    for (let end = candidate.id.lastIndexOf('.'); end >= 0; end = candidate.id.lastIndexOf('.', end - 1)) {
      const relativePath = candidate.id.slice(end + 1);
      if (relativePath.includes(':')) break;
      const id = candidate.id.slice(0, end);
      if (slicesById.has(id)) parents.push({ id, relativePath });
      if (end === 0) break;
    }
    if (!parents.length) continue;
    const pattern = extractPatternEntry(candidate);
    const fixed = pattern ? undefined : extractFixedEntry(candidate);
    const entry = pattern ?? fixed;
    if (!entry) continue;
    for (const { id, relativePath } of parents) {
      const patterns = children.get(id) ?? [];
      patterns.push({ relativePath, kind: pattern ? 'pattern' : 'fixed', key: entry.key, expected: entry.value });
      children.set(id, patterns);
    }
  }
  return children;
}

export function targetMatchesSliceDefinition(
  value: unknown,
  element: ElementDefinition,
  elements: ElementDefinition[],
  context?: SliceMatchContext,
): boolean {
  return matchesSliceAncestors(value, element, getSliceAncestors(element, elements),
    slice => getSliceChildPatternEntries(slice, elements), context);
}

function matchesSliceAncestors(
  value: unknown,
  element: ElementDefinition,
  sliceAncestors: ElementDefinition[],
  childPatterns: (slice: ElementDefinition) => SliceChildPattern[],
  context?: SliceMatchContext,
): boolean {
  if (sliceAncestors.length === 0) {
    return true;
  }

  for (const slice of sliceAncestors) {
    const sliceValue = slice === element
      ? value
      : getSliceAncestorValue(slice, element, context);

    if (sliceValue === undefined || !matchesSliceElement(sliceValue, slice, childPatterns)) {
      return false;
    }
  }

  return true;
}

function matchesSliceElement(
  value: unknown,
  element: ElementDefinition,
  childPatterns: (slice: ElementDefinition) => SliceChildPattern[],
): boolean {
  const inlinePattern = extractPatternEntry(element);
  if (inlinePattern && !matchesPattern(value, inlinePattern.value)) return false;
  const inlineFixed = extractFixedEntry(element);
  if (
    inlineFixed &&
    !valueCanIdentifyFixedSlice(value, inlineFixed.value, inlineFixed.key)
  ) return false;
  if (inlinePattern || inlineFixed) return true;

  const childPatternEntries = childPatterns(element);
  if (childPatternEntries.length === 0) {
    return matchesChoiceTypeSlice(value, element);
  }

  return childPatternEntries.every(({ relativePath, kind, key, expected }) => {
    const actual = getValueAtPath(value, relativePath);
    return kind === 'pattern'
      ? matchesPattern(actual, expected)
      : valueCanIdentifyFixedSlice(actual, expected, key);
  });
}

function matchesChoiceTypeSlice(
  value: unknown,
  element: ElementDefinition,
): boolean {
  if (!element.path.endsWith('[x]') || !Array.isArray(element.type)) return false;
  const actualType = inferType(value);
  return element.type.some(type =>
    isRecord(type) && type.code === actualType
  );
}

function getSliceAncestors(
  element: ElementDefinition,
  elements: ElementDefinition[],
): ElementDefinition[] {
  const elementId = element.id;
  if (!elementId) {
    return element.sliceName ? [element] : [];
  }

  return elements
    .filter(candidate =>
      isElementDefinition(candidate) &&
      Boolean(candidate.sliceName) &&
      typeof candidate.id === 'string' &&
      (elementId === candidate.id || elementId.startsWith(`${candidate.id}.`))
    )
    .sort((a, b) => (a.id?.length ?? 0) - (b.id?.length ?? 0));
}

function getSliceAncestorValue(
  slice: ElementDefinition,
  element: ElementDefinition,
  context: SliceMatchContext | undefined,
): unknown {
  if (!context || !slice.path || !element.path) return undefined;
  if (!pathStartsWith(element.path, slice.path)) return undefined;

  const concretePath = concretePathForAncestor(context.target.fullPath, slice.path);
  return concretePath ? getEvaluationContext(context.resource, concretePath) : undefined;
}

function concretePathForAncestor(targetFullPath: string, ancestorPath: string): string | null {
  const targetSegments = targetFullPath.split('.');
  const ancestorSegments = ancestorPath.split('.');
  if (targetSegments.length < ancestorSegments.length) return null;
  return targetSegments.slice(0, ancestorSegments.length).join('.');
}

function pathStartsWith(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

function getSliceChildPatternEntries(
  element: ElementDefinition,
  elements: ElementDefinition[],
): SliceChildPattern[] {
  if (!element.id) return [];
  const prefix = `${element.id}.`;

  return elements.flatMap(candidate => {
    if (!isElementDefinition(candidate)) return [];
    if (!candidate.id?.startsWith(prefix)) return [];
    const pattern = extractPatternEntry(candidate);
    const fixed = extractFixedEntry(candidate);
    const constraint = pattern
      ? { kind: 'pattern' as const, ...pattern }
      : fixed
        ? { kind: 'fixed' as const, ...fixed }
        : undefined;
    if (!constraint) return [];
    const relativePath = candidate.id.substring(prefix.length);
    if (relativePath.includes(':')) return [];
    return [{
      relativePath,
      kind: constraint.kind,
      key: constraint.key,
      expected: constraint.value,
    }];
  });
}

function isElementDefinition(value: unknown): value is ElementDefinition {
  return isRecord(value) && typeof value.path === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
