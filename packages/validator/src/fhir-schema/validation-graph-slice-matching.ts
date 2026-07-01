import {
  matchesPattern as matchesFhirPattern,
  valuesMatch,
} from '../validators/slice-utils';
import type { ValidationGraphNode } from './validation-graph-types';

export function matchesSliceForParent(
  value: unknown,
  parentNode: ValidationGraphNode,
  slice: ValidationGraphNode,
): boolean {
  const discriminatorPaths = discriminatorMatchPaths(parentNode);
  if (discriminatorPaths.length === 0) {
    return matchesSlice(value, slice);
  }

  return discriminatorPaths.every(path => matchesSlicePath(value, slice, path));
}

export function isSliceMatchableByValue(
  parentNode: ValidationGraphNode,
  slice: ValidationGraphNode,
): boolean {
  if (usesWholeElementDiscriminator(parentNode)) {
    return slice.fixed !== undefined || slice.pattern !== undefined;
  }
  return isPatternMatchableSlice(slice);
}

export function shouldReportUnmatchableRequiredSlice(
  parentNode: ValidationGraphNode,
  slice: ValidationGraphNode,
): boolean {
  if ((slice.min ?? 0) <= 0) {
    return false;
  }
  if (usesResolveDiscriminator(parentNode)) {
    return true;
  }
  return usesWholeElementDiscriminator(parentNode) && hasPatternMatchableChild(slice);
}

function discriminatorMatchPaths(parentNode: ValidationGraphNode): string[] {
  return (parentNode.slicing?.discriminator ?? [])
    .map(discriminator => normalizeDiscriminatorPath(discriminator.path))
    .filter(path => path !== '' && path !== '$this' && !path.includes('resolve()'));
}

function normalizeDiscriminatorPath(path: string): string {
  return path.startsWith('$this.') ? path.slice('$this.'.length) : path;
}

function matchesSlicePath(
  value: unknown,
  slice: ValidationGraphNode,
  path: string,
): boolean {
  const [head, ...tail] = path.split('.');
  const child = (slice.children ?? []).find(candidate =>
    !candidate.sliceName && candidate.name === normalizeChoiceBase(head)
  );
  if (!child) {
    return false;
  }

  const childValues = getDirectValues(value, child.name);
  if (tail.length === 0) {
    return childValues.some(childValue => matchesSlice(childValue, child));
  }

  return childValues.some(childValue => matchesSlicePath(childValue, child, tail.join('.')));
}

function normalizeChoiceBase(name: string): string {
  return name.endsWith('[x]') ? name.slice(0, -3) : name;
}

function matchesSlice(value: unknown, slice: ValidationGraphNode): boolean {
  if (slice.fixed !== undefined && !valuesMatch(value, slice.fixed)) {
    return false;
  }
  if (slice.pattern !== undefined && !matchesFhirPattern(value, slice.pattern)) {
    return false;
  }
  if (slice.fixed !== undefined || slice.pattern !== undefined) {
    return true;
  }

  const matchableChildren = (slice.children ?? []).filter(isPatternMatchableSlice);
  return matchableChildren.length > 0 && matchableChildren.every(child => {
    const childValues = getDirectValues(value, child.name);
    return childValues.some(childValue => matchesSlice(childValue, child));
  });
}

function usesResolveDiscriminator(node: ValidationGraphNode): boolean {
  return node.slicing?.discriminator.some(discriminator =>
    discriminator.path.includes('resolve()') || discriminator.path.includes('$this.resolve()')
  ) ?? false;
}

function usesWholeElementDiscriminator(node: ValidationGraphNode): boolean {
  return node.slicing?.discriminator.some(discriminator =>
    discriminator.path === '$this' || discriminator.path === ''
  ) ?? false;
}

function hasPatternMatchableChild(slice: ValidationGraphNode): boolean {
  return (slice.children ?? []).some(isPatternMatchableSlice);
}

function isPatternMatchableSlice(slice: ValidationGraphNode): boolean {
  return slice.fixed !== undefined
    || slice.pattern !== undefined
    || (slice.children ?? []).some(isPatternMatchableSlice);
}

function getDirectValues(parent: unknown, property: string): unknown[] {
  if (!isRecord(parent) || !(property in parent)) {
    return [];
  }
  const value = parent[property];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
