import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { getPatternOrFixedValue } from './terminology-binding-pattern-matching.js';

interface SlicePlan {
  elements: ElementDefinition[] | undefined;
  length: number;
  childConstraints: WeakMap<ElementDefinition, ElementDefinition[]>;
  owningSlices: WeakMap<ElementDefinition, ElementDefinition | null>;
  siblingPatterns: WeakMap<ElementDefinition, ElementDefinition[]>;
  valueSetDiscriminated: WeakMap<ElementDefinition, boolean>;
}

export class TerminologySlicePlanCache {
  private readonly plans = new WeakMap<StructureDefinition, SlicePlan>();

  getSliceChildConstraints(
    structureDef: StructureDefinition,
    elementDef: ElementDefinition,
  ): ElementDefinition[] {
    if (!elementDef.id || !elementDef.sliceName) return [];
    const plan = this.getPlan(structureDef);
    const cached = plan.childConstraints.get(elementDef);
    if (cached) return cached;
    const prefix = `${elementDef.id}.`;
    const constraints = plan.elements?.filter((candidate) =>
      typeof candidate.id === 'string'
      && candidate.id.startsWith(prefix)
      && getPatternOrFixedValue(candidate) !== undefined,
    ) ?? [];
    plan.childConstraints.set(elementDef, constraints);
    return constraints;
  }

  getOwningSliceElement(
    structureDef: StructureDefinition,
    elementDef: ElementDefinition,
  ): ElementDefinition | null {
    if (!elementDef.id || !elementDef.id.includes(':')) return null;
    if (elementDef.sliceName) return elementDef;
    const plan = this.getPlan(structureDef);
    if (plan.owningSlices.has(elementDef)) return plan.owningSlices.get(elementDef) ?? null;
    const owner = plan.elements
      ?.filter((candidate) =>
        Boolean(candidate.sliceName)
        && typeof candidate.id === 'string'
        && elementDef.id!.startsWith(`${candidate.id}.`),
      )
      .sort((left, right) => right.id!.length - left.id!.length)[0] ?? null;
    plan.owningSlices.set(elementDef, owner);
    return owner;
  }

  isValueSetDiscriminatedSliceRoot(
    elementDef: ElementDefinition,
    structureDef: StructureDefinition,
  ): boolean {
    if (!elementDef.sliceName || !elementDef.id?.includes(':') || !elementDef.binding?.valueSet) return false;
    const plan = this.getPlan(structureDef);
    const cached = plan.valueSetDiscriminated.get(elementDef);
    if (cached !== undefined) return cached;
    const result = plan.elements?.some((candidate) =>
      candidate !== elementDef
      && candidate.path === elementDef.path
      && Boolean(candidate.sliceName)
      && Boolean(candidate.binding?.valueSet),
    ) ?? false;
    plan.valueSetDiscriminated.set(elementDef, result);
    return result;
  }

  getSiblingSlicePatterns(
    structureDef: StructureDefinition,
    elementDef: ElementDefinition,
  ): ElementDefinition[] {
    const elementId = elementDef.id;
    if (!elementId || !elementDef.sliceName) return [];
    const plan = this.getPlan(structureDef);
    const cached = plan.siblingPatterns.get(elementDef);
    if (cached) return cached;
    const slicePrefix = elementId.slice(0, elementId.lastIndexOf(':') + 1);
    const siblings = plan.elements?.filter((candidate) =>
      candidate.id !== elementId
      && candidate.id?.startsWith(slicePrefix)
      && candidate.path === elementDef.path
      && Boolean(
        (candidate as ElementDefinition & { patternCoding?: unknown }).patternCoding
        || (candidate as ElementDefinition & { patternCodeableConcept?: unknown }).patternCodeableConcept,
      ),
    ) ?? [];
    plan.siblingPatterns.set(elementDef, siblings);
    return siblings;
  }

  private getPlan(structureDef: StructureDefinition): SlicePlan {
    const elements = structureDef.snapshot?.element;
    const current = this.plans.get(structureDef);
    if (current && current.elements === elements && current.length === (elements?.length ?? 0)) return current;
    const plan: SlicePlan = {
      elements,
      length: elements?.length ?? 0,
      childConstraints: new WeakMap(),
      owningSlices: new WeakMap(),
      siblingPatterns: new WeakMap(),
      valueSetDiscriminated: new WeakMap(),
    };
    this.plans.set(structureDef, plan);
    return plan;
  }
}
