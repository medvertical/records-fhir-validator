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
): ValueOccurrence[] {
  let contexts: ValueOccurrence[] = [{ value: root, path: '' }];
  for (const segment of relativePath.split('.').filter(Boolean)) {
    const next: ValueOccurrence[] = [];
    for (const context of contexts) {
      const resolved = resolveFhirSegmentValue(context.value, segment);
      const segmentPath = context.path ? `${context.path}.${segment}` : segment;
      if (Array.isArray(resolved)) {
        resolved.forEach((value, index) => {
          if (value !== undefined && value !== null) {
            next.push({ value, path: `${segmentPath}[${index}]` });
          }
        });
      } else if (resolved !== undefined && resolved !== null) {
        next.push({ value: resolved, path: segmentPath });
      }
    }
    contexts = next;
    if (contexts.length === 0) break;
  }
  return contexts;
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
    ? resolveValueOccurrences(root, parentPath)
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
