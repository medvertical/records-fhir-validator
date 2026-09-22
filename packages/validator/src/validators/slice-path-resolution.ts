import {
  getPrimitiveSidecar,
  resolveFhirSegmentValue,
} from '../core/fhir-primitive-sidecar.js';

export function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path || path === '$this') return obj;

  const normalizedPath = path.startsWith('$this.')
    ? path.slice('$this.'.length)
    : path;
  const parts = normalizedPath.split('.');
  const resolved = resolvePathParts(obj, parts, 0, new WeakSet<object>());
  return resolved ?? null;
}

function resolvePathParts(
  current: unknown,
  parts: string[],
  index: number,
  visitedArrays: WeakSet<object>,
): unknown {
  if (current === null || current === undefined) return undefined;
  if (index >= parts.length) return current;

  if (Array.isArray(current)) {
    if (visitedArrays.has(current)) return undefined;
    visitedArrays.add(current);
    const resolvedValues: unknown[] = [];
    for (const item of current) {
      const value = resolvePathParts(item, parts, index, visitedArrays);
      if (Array.isArray(value)) {
        resolvedValues.push(...value);
      } else if (value !== undefined) {
        resolvedValues.push(value);
      }
    }
    visitedArrays.delete(current);
    if (resolvedValues.length === 0) return undefined;
    return resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
  }

  const next = resolveSegmentForPath(current, parts[index], index < parts.length - 1);
  if (next === undefined) return undefined;
  return resolvePathParts(next, parts, index + 1, visitedArrays);
}

function resolveSegmentForPath(
  container: unknown,
  segment: string,
  hasRemainingPath: boolean,
): unknown {
  if (
    hasRemainingPath &&
    isObjectRecord(container) &&
    isPrimitiveValueOrPrimitiveArray(container[segment])
  ) {
    const sidecar = getPrimitiveSidecar(container, segment);
    if (sidecar !== undefined) return sidecar;
  }

  return resolveFhirSegmentValue(container, segment);
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null ||
    ['string', 'number', 'boolean'].includes(typeof value);
}

function isPrimitiveValueOrPrimitiveArray(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every(isPrimitiveValue)
    : isPrimitiveValue(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
