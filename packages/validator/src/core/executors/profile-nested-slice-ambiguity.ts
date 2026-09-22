import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

type DiscriminatorPredicateBuilder = (
  discriminator: { type?: string; path?: string },
  parentSlice: ElementDefinition,
  structureDef: StructureDefinition,
) => ((item: unknown) => boolean) | null;

/**
 * An item that also satisfies a sibling reslice's discriminator predicates
 * cannot be attributed to this slice — the discriminator does not separate
 * the reslices (BALP otherId/subject-id vs otherId/npi all fix the same
 * extension url). Validating such an item's nested content against an
 * arbitrarily chosen reslice fabricates pattern mismatches; the ambiguity
 * itself is reported as profile-slice-ambiguous-match by the slicing
 * validator, so the misattributed content run must stay silent.
 */
export function excludeAmbiguousResliceItems(
  matchedItems: unknown[],
  parentSlice: ElementDefinition,
  parentSlicingBase: ElementDefinition,
  structureDef: StructureDefinition,
  buildPredicate: DiscriminatorPredicateBuilder,
): unknown[] {
  const sliceName = parentSlice.sliceName;
  if (matchedItems.length === 0 || !sliceName?.includes('/')) return matchedItems;

  const siblingPredicateSets = findSiblingReslices(parentSlice, structureDef)
    .map(sibling => (parentSlicingBase.slicing?.discriminator ?? []).map(discriminator =>
      buildPredicate(discriminator, sibling, structureDef),
    ))
    .filter((siblingPredicates): siblingPredicates is Array<(item: unknown) => boolean> =>
      siblingPredicates.every(predicate => predicate !== null),
    );
  if (siblingPredicateSets.length === 0) return matchedItems;

  return matchedItems.filter(item =>
    !siblingPredicateSets.some(siblingPredicates =>
      siblingPredicates.every(predicate => predicate(item)),
    ),
  );
}

function findSiblingReslices(
  parentSlice: ElementDefinition,
  structureDef: StructureDefinition,
): ElementDefinition[] {
  const sliceName = parentSlice.sliceName!;
  const scopePrefix = parentSlice.id?.slice(0, parentSlice.id.lastIndexOf(':'));
  const resliceBase = `${sliceName.split('/')[0]}/`;
  return (structureDef.snapshot?.element ?? []).filter(element =>
    element.path === parentSlice.path &&
    element.id !== parentSlice.id &&
    typeof element.id === 'string' &&
    element.id.slice(0, element.id.lastIndexOf(':')) === scopePrefix &&
    typeof element.sliceName === 'string' &&
    element.sliceName !== sliceName &&
    element.sliceName.startsWith(resliceBase),
  );
}
