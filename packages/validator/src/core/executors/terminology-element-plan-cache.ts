import {
  ContentReferenceElementsCache,
  expandContentReferenceElements,
} from '../content-reference-elements.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import {
  getElementTypeCodes,
  isUsableElementDefinition,
} from './terminology-executor-helpers.js';
import { UCUM_BEARING_TYPES } from './terminology-ucum-rules.js';

export class TerminologyElementPlanCache {
  private readonly plans = new WeakMap<StructureDefinition, ElementDefinition[]>();
  private readonly contentReferenceElements = new ContentReferenceElementsCache();

  get(structureDef: StructureDefinition): ElementDefinition[] {
    const cached = this.plans.get(structureDef);
    if (cached) return cached;

    const snapshotElements = Array.isArray(structureDef.snapshot?.element)
      ? structureDef.snapshot.element.filter(isUsableElementDefinition)
      : [];
    const relevant = expandContentReferenceElements(
      snapshotElements,
      this.contentReferenceElements,
    ).filter((elementDef) => {
      if (elementDef.binding) return true;
      const types = getElementTypeCodes(elementDef);
      return (
        types.includes('CodeableConcept')
        || types.includes('Coding')
        || types.some((type) => UCUM_BEARING_TYPES.has(type))
      );
    });

    this.plans.set(structureDef, relevant);
    return relevant;
  }
}
