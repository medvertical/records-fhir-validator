import type { SDElement, StructureDefinition } from './fhir-schema-types';

export type BaseResolver = (url: string) => StructureDefinition | undefined;

export function mergeDifferentialWithBase(
  diffElements: SDElement[],
  baseElements: SDElement[],
): SDElement[] {
  const baseByPath = new Map<string, SDElement>();
  for (const el of baseElements) {
    baseByPath.set(el.path, { ...el });
  }

  for (const diff of diffElements) {
    const existing = baseByPath.get(diff.path);
    if (existing) {
      mergeDifferentialElement(existing, diff);
    } else {
      baseByPath.set(diff.path, { ...diff });
    }
  }

  return Array.from(baseByPath.values());
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
    if (baseSd?.snapshot?.element?.length) {
      const baseElements = baseSd.snapshot.element.map(el => ({
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
  if (diff.fixedString !== undefined) target.fixedString = diff.fixedString;
  if (diff.fixedCode !== undefined) target.fixedCode = diff.fixedCode;
  if (diff.fixedUri !== undefined) target.fixedUri = diff.fixedUri;
  if (diff.fixedBoolean !== undefined) target.fixedBoolean = diff.fixedBoolean;
  if (diff.patternCodeableConcept) target.patternCodeableConcept = diff.patternCodeableConcept;
  if (diff.patternCoding) target.patternCoding = diff.patternCoding;
  if (diff.patternIdentifier) target.patternIdentifier = diff.patternIdentifier;
}
