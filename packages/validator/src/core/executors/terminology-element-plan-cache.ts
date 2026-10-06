import {
  ContentReferenceElementsCache,
  expandContentReferenceElements,
  type ContentReferenceSources,
} from '../content-reference-elements.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import {
  getElementTypeCodes,
  isUsableElementDefinition,
} from './terminology-executor-helpers.js';
import { UCUM_BEARING_TYPES } from './terminology-ucum-rules.js';

export class TerminologyElementPlanCache {
  private readonly usableElements = new WeakMap<StructureDefinition, ElementDefinition[]>();
  private readonly plans = new WeakMap<ElementDefinition[], ElementDefinition[]>();
  private readonly contentReferenceElements = new ContentReferenceElementsCache();

  /** Elements with codes to check, recursive content expanded as deep as the instance goes. */
  get(
    structureDef: StructureDefinition,
    instancePaths?: ReadonlySet<string>,
    sources?: ContentReferenceSources,
  ): ElementDefinition[] {
    let usable = this.usableElements.get(structureDef);
    if (!usable) {
      usable = Array.isArray(structureDef.snapshot?.element)
        ? structureDef.snapshot.element.filter(isUsableElementDefinition)
        : [];
      this.usableElements.set(structureDef, usable);
    }
    // Snapshot-level expansions are cached, so their plans are too; one that
    // follows an instance deeper is built for that instance alone.
    const expanded = expandContentReferenceElements(usable, this.contentReferenceElements, instancePaths, sources);
    const cached = this.plans.get(expanded);
    if (cached) return cached;

    const relevant = expanded.filter((elementDef) => {
      if (elementDef.binding) return true;
      const types = getElementTypeCodes(elementDef);
      return (
        types.includes('CodeableConcept')
        || types.includes('Coding')
        || types.some((type) => UCUM_BEARING_TYPES.has(type))
      );
    });

    this.plans.set(expanded, relevant);
    return relevant;
  }
}
