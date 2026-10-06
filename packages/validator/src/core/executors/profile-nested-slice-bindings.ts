import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { codingMatchesBindingCodes } from '../../validators/slice-binding-code-matching.js';
import { normalizeCodes } from '../../validators/slice-info-input.js';

/**
 * An enclosing slice whose discriminator element fixes no value is told apart
 * by a required binding, as the reference validator tells it (CH Lab's CBC
 * names its RDW component by a value set alone). The scoping that reads the
 * codes is synchronous, so they are loaded beforehand; every validation
 * replaces what an earlier one loaded for the same profile.
 */
const codesByProfile = new WeakMap<StructureDefinition, Map<string, Set<string>>>();

export async function prepareNestedSliceBindings(
  structureDef: StructureDefinition,
  loadCodes: (valueSet: string) => Promise<string[] | null>,
): Promise<void> {
  const codes = new Map<string, Set<string>>();
  for (const valueSet of enclosingBindingValueSets(structureDef.snapshot?.element ?? [])) {
    try {
      const loaded = normalizeCodes(await loadCodes(valueSet));
      if (loaded.length > 0) codes.set(valueSet, new Set(loaded));
    } catch {
      // A value set that cannot be expanded leaves the slice undecided.
    }
  }
  codesByProfile.set(structureDef, codes);
}

/**
 * Membership by binding, or null when no loaded binding decides it. The
 * reference validator reads the binding from the first element along the
 * discriminator path that is not itself sliced (FR Core's qualification
 * slices from the first reslice of their coding), and its memberOf() decides
 * a single value only: an item with two codings there is in no such slice.
 */
export function bindingDiscriminatorPredicate(
  structureDef: StructureDefinition,
  constraintElements: ElementDefinition[],
  readValue: (item: unknown) => unknown,
): ((item: unknown) => boolean) | null {
  const valueSet = requiredValueSet(constraintElements.find(element => !element.slicing));
  const codes = valueSet ? codesByProfile.get(structureDef)?.get(valueSet) : undefined;
  if (!codes) return null;
  return item => {
    const values = [readValue(item) ?? []].flat();
    return values.length === 1 && codingMatchesBindingCodes(values[0], codes);
  };
}

/** Required bindings on the discriminator elements of slices that enclose further slicing. */
function enclosingBindingValueSets(elements: ElementDefinition[]): Set<string> {
  const byId = new Map(elements.map(element => [element.id, element]));
  const slicingIds = elements.filter(element => element.slicing).map(element => element.id ?? '');
  const valueSets = new Set<string>();
  for (const slice of elements) {
    if (!slice.sliceName || !slice.id || !slicingIds.some(id => id.startsWith(`${slice.id}.`))) continue;
    const baseId = slice.id.slice(0, slice.id.lastIndexOf(':'));
    for (const { type, path } of byId.get(baseId)?.slicing?.discriminator ?? []) {
      if (type !== 'value' && type !== 'pattern') continue;
      const target = !path || path === '$this' ? undefined : withoutSliceNames(`${slice.id}.${path}`);
      const constraint = target === undefined
        ? slice
        : elements.find(element => element.id?.startsWith(`${slice.id}.`) && !element.slicing && withoutSliceNames(element.id) === target);
      const valueSet = constraint && !fixesValue(constraint) ? requiredValueSet(constraint) : undefined;
      if (valueSet) valueSets.add(valueSet);
    }
  }
  return valueSets;
}

function withoutSliceNames(id: string): string {
  return id.split('.').map(segment => segment.split(':')[0]).join('.');
}

function requiredValueSet(element: ElementDefinition | undefined): string | undefined {
  return element?.binding?.strength === 'required' ? element.binding.valueSet : undefined;
}

function fixesValue(element: ElementDefinition): boolean {
  return Object.keys(element).some(key => key.startsWith('fixed') || key.startsWith('pattern'));
}
