/**
 * Array-aware validation target resolution for FHIR element paths.
 */

import { getPrimitiveSidecar, resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';
import {
  findChoiceSidecarProperty,
  findConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';

/**
 * Validation target for a specific path in a resource.
 * Includes the value, full path with array indices, and context path for parent checking.
 */
export interface ValidationTarget {
  /** Value at the target path */
  value: unknown;

  /** Full path including array indices (e.g., "Patient.identifier[0].system") */
  fullPath: string;

  /** Context path for parent existence checking (e.g., "Patient.identifier[0]") */
  contextPath: string;

  /** Whether this target is within an array element */
  isArrayElement: boolean;

  /** Array index if this is an array element */
  arrayIndex?: number;
}

/**
 * Check if the value at a given path is an array.
 */
export function isArrayAtPath(resource: unknown, path: string): boolean {
  const parts = path.split('.');
  const resourceType = isRecord(resource) && typeof resource.resourceType === 'string'
    ? resource.resourceType
    : undefined;
  if (parts[0] === resourceType) {
    parts.shift();
  }
  return pathResolvesToArray(resource, parts, 0, new WeakMap());
}

/**
 * Expand a path by inserting an array index.
 */
export function expandPathWithArrayIndex(
  path: string,
  arraySegment: string,
  index: number
): string {
  return path
    .split('.')
    .map(part => part === arraySegment ? `${part}[${index}]` : part)
    .join('.');
}

/**
 * Get all validation targets for a path, expanding arrays.
 */
export function getValidationTargets(
  resource: unknown,
  path: string
): ValidationTarget[] {
  if (!isRecord(resource)) {
    return [];
  }

  const parts = path.split('.');
  const startIndex = parts[0] === resource.resourceType ? 1 : 0;
  let targets: TraversalTarget[] = [{
    current: resource,
    pathSoFar: [],
    resourceTypePart: parts[0] === resource.resourceType ? parts[0] : ''
  }];

  for (let i = startIndex; i < parts.length; i++) {
    targets = resolveNextSegmentTargets(targets, parts[i], i < parts.length - 1);
  }

  return targets.map(convertToValidationTarget);
}

function resolveNextSegmentTargets(
  targets: TraversalTarget[],
  segment: string,
  hasRemainingPath: boolean,
): TraversalTarget[] {
  const newTargets: typeof targets = [];

  for (const target of targets) {
    if (target.current === undefined || target.current === null) {
      continue;
    }

    const nextValues = resolveSegmentTargets(target.current, segment, hasRemainingPath);
    for (const next of nextValues) {
      if (Array.isArray(next.value)) {
        next.value.forEach((item, arrayIndex) => {
          newTargets.push({
            current: item,
            pathSoFar: [...target.pathSoFar, `${next.pathSegment}[${arrayIndex}]`],
            resourceTypePart: target.resourceTypePart
          });
        });
        continue;
      }

      newTargets.push({
        current: next.value,
        pathSoFar: [...target.pathSoFar, next.pathSegment],
        resourceTypePart: target.resourceTypePart
      });
    }
  }

  return newTargets;
}

function resolveSegmentTargets(
  currentValue: unknown,
  segment: string,
  hasRemainingPath: boolean,
): Array<{ value: unknown; pathSegment: string }> {
  const indexedSegment = /^(.+)\[(\d+)\]$/.exec(segment);
  if (indexedSegment && isRecord(currentValue)) {
    const [, property, rawIndex] = indexedSegment;
    const collection = resolveFhirSegmentValue(currentValue, property);
    const index = Number(rawIndex);
    return [{
      value: Array.isArray(collection) ? collection[index] : undefined,
      pathSegment: `${property}[${index}]`,
    }];
  }

  if (segment.endsWith('[x]') && isRecord(currentValue)) {
    const baseName = segment.slice(0, -3);
    const directChoiceKey = findConcreteChoiceProperty(currentValue, baseName);
    if (directChoiceKey) {
      const sidecar = hasRemainingPath
        ? getPrimitiveSidecar(currentValue, directChoiceKey)
        : undefined;
      return [{
        value: sidecar ?? currentValue[directChoiceKey],
        pathSegment: directChoiceKey,
      }];
    }

    const sidecarChoiceKey = findChoiceSidecarProperty(currentValue, baseName);
    if (sidecarChoiceKey) {
      return [{
        value: resolveFhirSegmentValue(currentValue, segment),
        pathSegment: sidecarChoiceKey.slice(1),
      }];
    }
  }

  if (
    hasRemainingPath &&
    isRecord(currentValue) &&
    isPrimitiveValueOrPrimitiveArray(currentValue[segment])
  ) {
    const sidecar = getPrimitiveSidecar(currentValue, segment);
    if (sidecar !== undefined) return [{ value: sidecar, pathSegment: segment }];
  }

  return [{ value: resolveSegmentValue(currentValue, segment), pathSegment: segment }];
}

function isPrimitiveValueOrPrimitiveArray(value: unknown): boolean {
  const isPrimitive = (candidate: unknown): boolean =>
    candidate === null || ['string', 'number', 'boolean'].includes(typeof candidate);
  return Array.isArray(value) ? value.every(isPrimitive) : isPrimitive(value);
}

function resolveSegmentValue(currentValue: unknown, segment: string): unknown {
  return resolveFhirSegmentValue(currentValue, segment);
}

function convertToValidationTarget(target: TraversalTarget): ValidationTarget {
  const relativePath = target.pathSoFar.join('.');
  const fullPath = target.resourceTypePart && relativePath
    ? `${target.resourceTypePart}.${relativePath}`
    : target.resourceTypePart || relativePath;
  const contextPathParts = target.pathSoFar.slice(0, -1);
  const contextRelativePath = contextPathParts.join('.');
  const contextPath = target.resourceTypePart && contextRelativePath
    ? `${target.resourceTypePart}.${contextRelativePath}`
    : target.resourceTypePart || contextRelativePath;

  return {
    value: target.current,
    fullPath,
    contextPath: contextPath || target.resourceTypePart,
    isArrayElement: target.pathSoFar.some(segment => /\[\d+\]/.test(segment)),
    arrayIndex: getLastArrayIndex(target.pathSoFar)
  };
}

interface TraversalTarget {
  current: unknown;
  pathSoFar: string[];
  resourceTypePart: string;
}

function pathResolvesToArray(
  current: unknown,
  segments: string[],
  index: number,
  visitedArrays: WeakMap<object, Set<number>>,
): boolean {
  if (index >= segments.length) return Array.isArray(current);
  if (current === undefined || current === null) return false;
  if (Array.isArray(current)) {
    if (wasVisitedAtIndex(current, index, visitedArrays)) return false;
    return current.some(item =>
      pathResolvesToArray(item, segments, index, visitedArrays)
    );
  }
  if (!isRecord(current)) return false;
  return pathResolvesToArray(
    resolveFhirSegmentValue(current, segments[index]),
    segments,
    index + 1,
    visitedArrays,
  );
}

function wasVisitedAtIndex(
  value: object,
  index: number,
  visited: WeakMap<object, Set<number>>,
): boolean {
  const indices = visited.get(value);
  if (indices?.has(index)) return true;
  if (indices) indices.add(index);
  else visited.set(value, new Set([index]));
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getLastArrayIndex(pathSegments: string[]): number | undefined {
  for (let i = pathSegments.length - 1; i >= 0; i--) {
    const match = pathSegments[i].match(/\[(\d+)\]/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}
