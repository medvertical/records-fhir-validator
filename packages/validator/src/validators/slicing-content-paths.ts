import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';

export interface ValueOccurrence {
  value: unknown;
  path: string;
}

export interface ChildCardinality {
  path: string;
  count: number;
}

export function resolveValueOccurrences(
  root: unknown,
  relativePath: string,
  // Whether the last segment's values are parents whose children are read next.
  asParents = false,
): ValueOccurrence[] {
  let contexts: ValueOccurrence[] = [{ value: root, path: '' }];
  const segments = relativePath.split('.').filter(Boolean);
  segments.forEach((segment, position) => {
    const descends = asParents || position < segments.length - 1;
    const next: ValueOccurrence[] = [];
    for (const context of contexts) {
      const resolved = resolveFhirSegmentValue(context.value, segment);
      const segmentPath = context.path ? `${context.path}.${segment}` : segment;
      const sidecar = descends && isRecord(context.value) ? context.value[`_${segment}`] : undefined;
      if (Array.isArray(resolved)) {
        resolved.forEach((value, index) => {
          const element = descends ? elementOf(value, Array.isArray(sidecar) ? sidecar[index] : undefined) : value;
          if (element !== undefined && element !== null) next.push({ value: element, path: `${segmentPath}[${index}]` });
        });
      } else if (resolved !== undefined && resolved !== null) {
        next.push({ value: descends ? elementOf(resolved, sidecar) : resolved, path: segmentPath });
      }
    }
    contexts = next;
  });
  return contexts;
}

/** A primitive's own children (`id`, `extension`) sit in its `_name` sidecar. */
function elementOf(value: unknown, sidecar: unknown): unknown {
  if (value === null || typeof value === 'object') return value;
  return isRecord(sidecar) ? sidecar : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getChildCardinalities(
  root: unknown,
  relativePath: string,
): ChildCardinality[] {
  const segments = relativePath.split('.').filter(Boolean);
  const leaf = segments.pop();
  if (!leaf) return [];

  const parentPath = segments.join('.');
  const parents = parentPath
    ? resolveValueOccurrences(root, parentPath, true)
    : [{ value: root, path: '' }];

  return parents.map(parent => {
    const actual = resolveFhirSegmentValue(parent.value, leaf);
    const count = Array.isArray(actual)
      ? actual.length
      : actual === undefined || actual === null ? 0 : 1;
    return {
      path: parent.path ? `${parent.path}.${leaf}` : leaf,
      count,
    };
  });
}
