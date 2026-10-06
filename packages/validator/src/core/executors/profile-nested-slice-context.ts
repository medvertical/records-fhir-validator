import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

type ElementDef = { id?: string; path?: string };

function isSlicingNestedUnderSlice(elementDef: ElementDef): boolean {
  const id = elementDef.id;
  if (!id || !elementDef.path) return false;
  const segments = id.split('.');
  const pathDepth = elementDef.path.split('.').length;
  return segments.length >= pathDepth && segments.slice(0, -1).some(segment => segment.includes(':'));
}

export function findNestedSliceContext(
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): { sliceElement: ElementDefinition } | null {
  const id = elementDef.id;
  if (!id || !elementDef.path || !isSlicingNestedUnderSlice(elementDef)) return null;

  const idParts = id.split('.');
  for (let end = idParts.length - 1; end > 0; end -= 1) {
    const candidateId = idParts.slice(0, end).join('.');
    if (!candidateId.includes(':')) continue;

    const candidate = structureDef.snapshot?.element?.find(e => e.id === candidateId);
    if (candidate?.sliceName && candidate.path && elementDef.path.startsWith(candidate.path)) {
      return { sliceElement: candidate };
    }
  }

  return null;
}

/** The slices an element sits in, outermost first, ending with the innermost one. */
export function enclosingSlices(
  elementDef: ElementDef,
  structureDef: StructureDefinition,
  innermost: ElementDefinition,
): ElementDefinition[] {
  const segments = (innermost.id ?? '').split('.');
  const outer = segments.slice(0, -1).flatMap((segment, index) => {
    if (!segment.includes(':')) return [];
    const id = segments.slice(0, index + 1).join('.');
    const slice = structureDef.snapshot?.element?.find(element => element.id === id);
    return slice?.sliceName && slice.path && elementDef.path?.startsWith(slice.path) ? [slice] : [];
  });
  return [...outer, innermost];
}
