import type { SDElement, StructureDefinition } from './fhir-schema-types';

export type BaseResolver = (url: string) => StructureDefinition | undefined;

export function mergeDifferentialWithBase(
  diffElements: SDElement[],
  baseElements: SDElement[],
): SDElement[] {
  const baseByPath = new Map<string, SDElement>();
  for (const el of baseElements) {
    baseByPath.set(elementMergeKey(el), { ...el });
  }

  for (const diff of diffElements) {
    const existing = baseByPath.get(elementMergeKey(diff));
    if (existing) {
      mergeDifferentialElement(existing, diff);
    } else {
      baseByPath.set(elementMergeKey(diff), { ...diff });
    }
  }

  return Array.from(baseByPath.values());
}

function elementMergeKey(el: SDElement): string {
  if (typeof el.id === 'string' && el.id.length > 0) {
    return el.id;
  }

  if (typeof el.sliceName === 'string' && el.sliceName.length > 0) {
    return `${el.path}:${el.sliceName}`;
  }

  return el.path;
}

export function resolveElements(
  sd: StructureDefinition,
  resolveBase?: BaseResolver,
): SDElement[] {
  if (sd.snapshot?.element?.length) {
    return sd.snapshot.element;
  }

  if (!sd.differential?.element?.length) {
    return [];
  }

  if (resolveBase && sd.baseDefinition) {
    const baseSd = resolveBase(sd.baseDefinition);
    if (baseSd) {
      const resolvedBaseElements = resolveElements(baseSd, resolveBase);
      if (resolvedBaseElements.length === 0) {
        return sd.differential.element;
      }
      const baseElements = resolvedBaseElements.map(el => ({
        ...el,
        path: el.path.replace(new RegExp(`^${baseSd.type}`), sd.type),
      }));
      return mergeDifferentialWithBase(sd.differential.element, baseElements);
    }
  }

  return sd.differential.element;
}

function mergeDifferentialElement(target: SDElement, diff: SDElement): void {
  if (diff.min !== undefined) target.min = diff.min;
  if (diff.max !== undefined) target.max = diff.max;
  if (diff.type) target.type = diff.type;
  if (diff.binding) target.binding = diff.binding;
  if (diff.constraint) {
    target.constraint = [...(target.constraint || []), ...diff.constraint];
  }
  if (diff.slicing) target.slicing = diff.slicing;
  if (diff.sliceName) target.sliceName = diff.sliceName;
  for (const [key, value] of Object.entries(diff)) {
    if ((key.startsWith('fixed') || key.startsWith('pattern')) && value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}
