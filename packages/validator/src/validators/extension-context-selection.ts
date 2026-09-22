import type { ElementDefinition } from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { targetMatchesSliceDefinition } from './constraint-slice-targets.js';
import type { ExtensionDefinition } from './extension-types.js';

export function selectDefinitionsForResourceContext(
  candidatesByUrl: Map<string, ExtensionDefinition[]>,
  elements: ElementDefinition[],
  resource: unknown,
): Map<string, ExtensionDefinition> {
  const selected = new Map<string, ExtensionDefinition>();

  for (const [url, candidates] of candidatesByUrl.entries()) {
    const matching = candidates.filter(candidate =>
      definitionMatchesResourceContext(candidate, elements, resource)
    );
    const chosen = matching[matching.length - 1];
    if (chosen) selected.set(url, chosen);
  }

  return selected;
}

function definitionMatchesResourceContext(
  definition: ExtensionDefinition,
  elements: ElementDefinition[],
  resource: unknown,
): boolean {
  if (!definition.elementId) return true;

  const sliceAncestors = elements.filter(candidate =>
    Boolean(candidate.sliceName) &&
    typeof candidate.id === 'string' &&
    candidate.id !== definition.elementId &&
    definition.elementId!.startsWith(`${candidate.id}.`)
  );
  if (sliceAncestors.length === 0) return true;

  return sliceAncestors.every(slice => {
    const targets = getValidationTargets(resource, slice.path);
    return targets.some(target =>
      targetMatchesSliceDefinition(target.value, slice, elements, { resource, target })
    );
  });
}
