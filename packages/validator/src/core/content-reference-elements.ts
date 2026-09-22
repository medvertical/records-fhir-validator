import type { ElementDefinition } from './structure-definition-types.js';

export class ContentReferenceElementsCache {
  private readonly expanded = new WeakMap<ElementDefinition[], ElementDefinition[]>();

  get(elements: ElementDefinition[]): ElementDefinition[] | undefined {
    return this.expanded.get(elements);
  }

  set(elements: ElementDefinition[], expanded: ElementDefinition[]): void {
    this.expanded.set(elements, expanded);
  }
}

export function expandContentReferenceElements(
  elements: ElementDefinition[],
  cache: ContentReferenceElementsCache = new ContentReferenceElementsCache(),
): ElementDefinition[] {
  const cached = cache.get(elements);
  if (cached) return cached;

  const expanded: ElementDefinition[] = [...elements];
  const seen = new Set(elements.map(element => element.id ?? element.path));

  for (const element of elements) {
    const referencePath = getContentReferencePath(element);
    if (!referencePath || referencePath === element.path || isSliceScoped(element)) continue;

    const referenceChildPrefix = `${referencePath}.`;
    for (const referenceChild of elements) {
      if (!referenceChild.path.startsWith(referenceChildPrefix)) continue;
      // Slice-scoped constraints (binding, fixed values) apply only where the
      // discriminator matched; copying them to the recursion point would make
      // them fire on every nested occurrence. Only the unsliced tree carries
      // the referenced content model.
      if (isSliceScoped(referenceChild)) continue;

      const suffix = referenceChild.path.slice(referencePath.length);
      const path = `${element.path}${suffix}`;
      const id = rewriteContentReferenceId(referenceChild.id, referencePath, element.id ?? element.path, path);
      const key = id ?? path;
      if (seen.has(key)) continue;

      expanded.push({
        ...referenceChild,
        id,
        path,
      });
      seen.add(key);
    }
  }

  cache.set(elements, expanded);
  return expanded;
}

function isSliceScoped(element: ElementDefinition): boolean {
  return typeof element.id === 'string' && element.id.includes(':');
}

function getContentReferencePath(element: ElementDefinition): string | null {
  const { contentReference } = element;
  if (typeof contentReference !== 'string') return null;
  // Base-spec snapshots use the local form "#Type.path"; IG-publisher profile
  // snapshots emit the absolute form "<sd-url>#Type.path". Both resolve within
  // the current snapshot (it carries the constrained type's full element
  // tree); a fragment pointing at a foreign type simply matches no children.
  const fragmentIndex = contentReference.indexOf('#');
  if (fragmentIndex < 0) return null;
  const path = contentReference.slice(fragmentIndex + 1);
  return path.length > 0 ? path : null;
}

function rewriteContentReferenceId(
  referenceId: string | undefined,
  referencePath: string,
  targetBase: string,
  fallbackPath: string,
): string {
  return referenceId?.startsWith(referencePath)
    ? `${targetBase}${referenceId.slice(referencePath.length)}`
    : fallbackPath;
}
