import type { ElementDefinition } from '../core/structure-definition-types.js';

const MAX_DESCENDANT_REFERENCES = 65_536;

/** Lookup-only indexes over one extraction's elements; order and duplicate IDs remain significant. */
export function createSliceElementIndex(elements: ElementDefinition[], atPath: ElementDefinition[]) {
  const prefixes = new Set(atPath.filter(element => element.sliceName).flatMap(element => {
    const fallback = `${element.path}:${element.sliceName}`;
    return [`${element.id ?? fallback}.`, `${element.id || fallback}.`];
  }));
  // A few direct scans cost less than building the index for a small slicing group.
  if (prefixes.size < 4 || prefixes.size * elements.length < 2_000) return undefined;
  const byId = new Map<string, ElementDefinition[]>();
  const byPrefix = new Map<string, ElementDefinition[]>();
  let descendantReferences = 0;
  let indexComplete = true;
  for (const element of elements) {
    if (typeof element.id !== 'string') continue;
    const sameId = byId.get(element.id);
    if (sameId) sameId.push(element);
    else byId.set(element.id, [element]);
    if (!indexComplete) continue;
    for (let offset = element.id.indexOf('.'); offset >= 0; offset = element.id.indexOf('.', offset + 1)) {
      const prefix = element.id.slice(0, offset + 1);
      if (!prefixes.has(prefix)) continue;
      // Malformed definitions may declare the same path at arbitrarily many ID depths.
      if (++descendantReferences > MAX_DESCENDANT_REFERENCES) {
        byPrefix.clear();
        indexComplete = false;
        break;
      }
      const descendants = byPrefix.get(prefix);
      if (descendants) descendants.push(element);
      else byPrefix.set(prefix, [element]);
    }
  }
  return {
    descendants(prefix: string): ElementDefinition[] {
      return indexComplete && prefixes.has(prefix) ? byPrefix.get(prefix) ?? []
        : elements.filter(element => typeof element.id === 'string' && element.id.startsWith(prefix));
    },
    ancestors(id: string | undefined): ElementDefinition[] {
      if (typeof id !== 'string') return [];
      const ancestors: ElementDefinition[] = [];
      for (let offset = id.indexOf('.'); offset >= 0; offset = id.indexOf('.', offset + 1)) {
        for (const ancestor of byId.get(id.slice(0, offset)) ?? []) ancestors.push(ancestor);
      }
      return ancestors;
    },
  };
}
