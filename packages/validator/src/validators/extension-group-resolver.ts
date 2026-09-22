import {
  findChoiceSidecarProperty,
  findConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';
import { isRecord } from '../core/fhir-resource.js';
import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';

export type GetValueAtPath<TResource> = (
  resource: TResource,
  path: string,
) => unknown;

/**
 * Get extension arrays grouped by parent element instance.
 *
 * For paths like `Account.coverage.extension`, if `coverage` is an array,
 * returns one group per coverage item. Cardinality constraints apply per
 * group, not globally across the flattened array.
 */
export function getExtensionGroupsByParent<TResource>(
  resource: TResource,
  elementPath: string,
  getValueAtPath: GetValueAtPath<TResource>,
): unknown[][] {
  const lastDot = elementPath.lastIndexOf('.');
  if (lastDot <= 0) {
    const rawValue = readValueAtPath(resource, elementPath, getValueAtPath);
    return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
  }

  const parentPath = elementPath.substring(0, lastDot);
  const leafKey = elementPath.substring(lastDot + 1);

  const primitiveSidecarGroups = getPrimitiveExtensionGroups(resource, parentPath, leafKey);
  if (primitiveSidecarGroups) return primitiveSidecarGroups;

  const parentRaw = readValueAtPath(resource, parentPath, getValueAtPath);
  if (parentRaw == null) return [];

  const parents = Array.isArray(parentRaw) ? parentRaw : [parentRaw];
  const groups: unknown[][] = [];

  for (const parent of parents) {
    if (!isRecord(parent)) continue;
    const exts = parent[leafKey];
    if (Array.isArray(exts)) {
      groups.push(exts);
    } else if (exts != null) {
      groups.push([exts]);
    } else {
      groups.push([]);
    }
  }

  if (groups.length === 0) {
    const rawValue = readValueAtPath(resource, elementPath, getValueAtPath);
    return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
  }

  return groups;
}

function getPrimitiveExtensionGroups(
  resource: unknown,
  parentPath: string,
  leafKey: string
): unknown[][] | null {
  if (leafKey !== 'extension' && leafKey !== 'modifierExtension') return null;

  const parentLastDot = parentPath.lastIndexOf('.');
  if (parentLastDot <= 0) return null;

  const containerPath = parentPath.substring(0, parentLastDot);
  const primitiveKey = parentPath.substring(parentLastDot + 1);
  if (!primitiveKey || primitiveKey.startsWith('_')) return null;

  const containers = getValuesAtPath(resource, containerPath);
  const groups: unknown[][] = [];
  let foundPrimitiveParent = false;

  for (const container of containers) {
    if (!isRecord(container)) continue;
    const actualPrimitiveKey = resolvePrimitiveKey(container, primitiveKey);
    if (!actualPrimitiveKey) continue;

    const primitiveValue = container[actualPrimitiveKey];
    const sidecar = container[`_${actualPrimitiveKey}`];
    if (
      primitiveValue !== undefined &&
      !isPrimitiveElementValue(primitiveValue)
    ) continue;
    if (primitiveValue === undefined && sidecar === undefined) continue;
    foundPrimitiveParent = true;

    if (Array.isArray(primitiveValue)) {
      for (let i = 0; i < primitiveValue.length; i++) {
        const sidecarItem = Array.isArray(sidecar) ? sidecar[i] : sidecar;
        groups.push(getExtensionGroupFromSidecar(sidecarItem, leafKey));
      }
    } else {
      groups.push(getExtensionGroupFromSidecar(sidecar, leafKey));
    }
  }

  return foundPrimitiveParent ? groups : null;
}

function isPrimitiveElementValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(item => item == null || typeof item !== 'object');
  }

  return value == null || typeof value !== 'object';
}

function getExtensionGroupFromSidecar(sidecar: unknown, leafKey: string): unknown[] {
  if (!isRecord(sidecar)) return [];
  const exts = sidecar[leafKey];
  if (Array.isArray(exts)) return exts;
  return exts != null ? [exts] : [];
}

function getValuesAtPath(resource: unknown, path: string): unknown[] {
  if (!path) return [resource];
  const resourceType = isRecord(resource) && typeof resource.resourceType === 'string'
    ? resource.resourceType
    : undefined;
  const segments = path
    .split('.')
    .filter(Boolean)
    .filter((segment, index) => !(index === 0 && segment === resourceType));
  const visitedArrays = new WeakMap<object, Set<number>>();

  const walk = (value: unknown, index: number): unknown[] => {
    if (value == null) return [];
    if (index >= segments.length) return Array.isArray(value) ? value : [value];
    if (Array.isArray(value)) {
      if (wasVisitedAtIndex(value, index, visitedArrays)) return [];
      return value.flatMap(item => walk(item, index));
    }

    if (!isRecord(value)) return [];
    const segment = segments[index];
    const next = resolveFhirSegmentValue(value, segment);
    return walk(next, index + 1);
  };

  return walk(resource, 0);
}

function resolvePrimitiveKey(
  container: Record<string, unknown>,
  primitiveKey: string,
): string | null {
  if (!primitiveKey.endsWith('[x]')) {
    return primitiveKey in container || `_${primitiveKey}` in container
      ? primitiveKey
      : null;
  }
  const base = primitiveKey.slice(0, -3);
  return findConcreteChoiceProperty(container, base)
    ?? findChoiceSidecarProperty(container, base)?.slice(1)
    ?? null;
}

function readValueAtPath<TResource>(
  resource: TResource,
  path: string,
  getValueAtPath: GetValueAtPath<TResource>,
): unknown {
  try {
    return getValueAtPath(resource, path);
  } catch {
    return undefined;
  }
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
