import type { ElementDefinition, StructureDefinition } from './structure-definition-types.js';

/**
 * Snapshots of the definitions an absolute contentReference names, other than
 * the one being expanded (for most profiles: the base resource).
 */
export interface ContentReferenceSources {
  ownUrl?: string;
  elementsOf(url: string): ElementDefinition[] | undefined;
}

export class ContentReferenceElementsCache {
  private readonly expanded = new WeakMap<ElementDefinition[], Map<string, ElementDefinition[]>>();

  get(elements: ElementDefinition[], variant: string): ElementDefinition[] | undefined {
    return this.expanded.get(elements)?.get(variant);
  }

  set(elements: ElementDefinition[], variant: string, expanded: ElementDefinition[]): void {
    const variants = this.expanded.get(elements) ?? new Map<string, ElementDefinition[]>();
    variants.set(variant, expanded);
    this.expanded.set(elements, variants);
  }
}

/**
 * The element paths present in `value`, rooted at its resource type and
 * without indices (`Questionnaire.item.item`), primitive sidecars folded in.
 */
export function instanceElementPaths(value: unknown): Set<string> {
  const paths = new Set<string>();
  const root = value && typeof value === 'object' ? (value as { resourceType?: unknown }).resourceType : undefined;
  if (typeof root !== 'string') return paths;
  const pending: Array<[unknown, string]> = [[value, root]];
  while (pending.length > 0) {
    const [node, path] = pending.pop()!;
    if (Array.isArray(node)) {
      for (const item of node) pending.push([item, path]);
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'resourceType') continue;
        const childPath = `${path}.${key.startsWith('_') ? key.slice(1) : key}`;
        paths.add(childPath);
        pending.push([child, childPath]);
      }
    }
  }
  return paths;
}

/** Loads the snapshots the absolute contentReferences of `structureDef` name. */
export async function loadContentReferenceSources(
  structureDef: StructureDefinition,
  load: (url: string) => Promise<StructureDefinition | null | undefined>,
): Promise<ContentReferenceSources> {
  const ownUrl = typeof structureDef.url === 'string' ? structureDef.url : undefined;
  const urls = new Set<string>();
  for (const element of structureDef.snapshot?.element ?? []) {
    const url = parseContentReference(element)?.url;
    if (url && !sameCanonical(url, ownUrl)) urls.add(url);
  }
  const loaded = new Map<string, ElementDefinition[]>();
  for (const url of urls) {
    const definition = await load(url).catch(() => null);
    const elements = definition?.snapshot?.element;
    if (Array.isArray(elements)) loaded.set(url, elements);
  }
  return { ownUrl, elementsOf: url => loaded.get(url) };
}

/**
 * Copies the referenced content model to every contentReference element
 * (`Questionnaire.item.item` → `#Questionnaire.item`). A local reference names
 * an element of the same snapshot; an absolute one, as IG-publisher profiles
 * write it, names the element in that definition — usually the base resource,
 * so a nested Composition.section follows the base rules, not the profile's
 * top-level ones (ProfileUtilities.getChildMap in the reference validator).
 * Without `sources` every reference resolves locally.
 *
 * A recursive model has no depth of its own. The snapshot's own recursion
 * points are always expanded; deeper ones only where `instancePaths` shows
 * the instance at hand reaches them.
 */
export function expandContentReferenceElements(
  elements: ElementDefinition[],
  cache: ContentReferenceElementsCache = new ContentReferenceElementsCache(),
  instancePaths?: ReadonlySet<string>,
  sources?: ContentReferenceSources,
): ElementDefinition[] {
  const variant = sources ? 'sourced' : 'local';
  let snapshotLevel = cache.get(elements, variant);
  if (!snapshotLevel) {
    snapshotLevel = expand(elements, sources);
    cache.set(elements, variant, snapshotLevel);
  }
  const reachesDeeper = instancePaths !== undefined && snapshotLevel.some((element, index) =>
    index >= elements.length && element.contentReference !== undefined && instancePaths.has(element.path));
  return reachesDeeper ? expand(elements, sources, instancePaths) : snapshotLevel;
}

function expand(
  elements: ElementDefinition[],
  sources?: ContentReferenceSources,
  instancePaths?: ReadonlySet<string>,
): ElementDefinition[] {
  const expanded: ElementDefinition[] = [...elements];
  const seen = new Set(elements.map(element => element.id ?? element.path));
  const recursionPoints = [...elements];

  for (let index = 0; index < recursionPoints.length; index += 1) {
    const element = recursionPoints[index];
    const reference = parseContentReference(element);
    if (!reference || reference.path === element.path || isSliceScoped(element)) continue;
    const foreign = reference.url && !sameCanonical(reference.url, sources?.ownUrl)
      ? sources?.elementsOf(reference.url)
      : undefined;

    const referenceChildPrefix = `${reference.path}.`;
    for (const referenceChild of foreign ?? elements) {
      if (!referenceChild.path.startsWith(referenceChildPrefix)) continue;
      // Slice-scoped constraints (binding, fixed values) apply only where the
      // discriminator matched; copying them to the recursion point would make
      // them fire on every nested occurrence. Only the unsliced tree carries
      // the referenced content model.
      if (isSliceScoped(referenceChild)) continue;

      const suffix = referenceChild.path.slice(reference.path.length);
      const path = `${element.path}${suffix}`;
      const id = rewriteContentReferenceId(referenceChild.id, reference.path, element.id ?? element.path, path);
      const key = id ?? path;
      if (seen.has(key)) continue;

      const copy = { ...referenceChild, id, path };
      // A nested local reference of the foreign definition stays in it.
      if (foreign && copy.contentReference?.startsWith('#')) {
        copy.contentReference = `${reference.url}${copy.contentReference}`;
      }
      expanded.push(copy);
      seen.add(key);
      if (copy.contentReference && instancePaths?.has(path)) recursionPoints.push(copy);
    }
  }
  return expanded;
}

function isSliceScoped(element: ElementDefinition): boolean {
  return typeof element.id === 'string' && element.id.includes(':');
}

/** Base-spec snapshots use the local form "#Type.path", IG-publisher profiles "<sd-url>#Type.path". */
function parseContentReference(element: ElementDefinition): { url?: string; path: string } | null {
  const { contentReference } = element;
  if (typeof contentReference !== 'string') return null;
  const fragmentIndex = contentReference.indexOf('#');
  if (fragmentIndex < 0) return null;
  const path = contentReference.slice(fragmentIndex + 1);
  if (path.length === 0) return null;
  return fragmentIndex > 0 ? { url: contentReference.slice(0, fragmentIndex), path } : { path };
}

function sameCanonical(left: string, right: string | undefined): boolean {
  return right !== undefined && left.split('|')[0] === right.split('|')[0];
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
