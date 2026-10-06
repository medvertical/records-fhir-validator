import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';

/** Loads the StructureDefinition of a resource or datatype by its type name. */
export type TypeDefinitionLookup = (typeName: string) => Promise<StructureDefinition | null>;

const INLINE_STRUCTURE_TYPES = new Set(['BackboneElement', 'Element']);
const MAX_TYPE_HIERARCHY_DEPTH = 8;

/**
 * The names the reference validator knows an element by when it checks where
 * an extension may be used (its NodeStack "logical paths"): the path from the
 * resource root, the target of a contentReference re-entry
 * (`PlanDefinition.action` for a nested action), the element's datatype
 * (`Attachment`), paths rooted at that datatype (`RelatedArtifact.document`),
 * and each of those again under every base type (`Element`,
 * `DomainResource.…`). Null when an element on the way does not resolve to a
 * single definition; the caller then cannot prove a violation.
 */
export async function resolveLogicalPaths(
  resourceType: string,
  elementPath: string,
  lookup: TypeDefinitionLookup,
): Promise<string[] | null> {
  const segments = elementPath.split('.');
  if (segments[0] !== resourceType) return null;
  let definitions = (await lookup(resourceType))?.snapshot?.element;
  if (!definitions) return null;
  let definitionPath = resourceType;
  let logicalPaths = new Set([resourceType]);

  for (let index = 1; index < segments.length; index += 1) {
    const name = segments[index];
    const child = findChildDefinition(definitions, definitionPath, name);
    if (!child) return null;
    const { element, choiceType } = child;
    const tail = element.path.slice(element.path.lastIndexOf('.') + 1);
    const next = new Set<string>();
    for (const parent of logicalPaths) {
      if (!isRealPath(parent, choiceType ? tail : name)) continue;
      if (choiceType) {
        const stem = tail.slice(0, -'[x]'.length);
        next.add(`${parent}.${tail}`);
        next.add(`${parent}.${stem}.ofType(${choiceType})`);
        next.add(`${parent}.${name}`);
      } else {
        next.add(`${parent}.${name}`);
      }
    }

    const isLast = index === segments.length - 1;
    if (element.contentReference) {
      const target = element.contentReference.slice(element.contentReference.indexOf('#') + 1);
      next.add(target);
      definitionPath = target;
    } else {
      const types = choiceType ? [choiceType] : (element.type ?? []).map(type => type.code);
      if (types.length !== 1) return null;
      const [type] = types;
      next.add(type);
      if (INLINE_STRUCTURE_TYPES.has(type)) {
        definitionPath = element.path;
      } else if (!isLast) {
        const datatype = await lookup(type);
        definitions = datatype?.snapshot?.element;
        if (!definitions) return null;
        definitionPath = datatype?.type ?? type;
      }
    }
    logicalPaths = next;
  }
  return expandTypeHierarchy([...logicalPaths], lookup);
}

/**
 * HAPI's `hasElementName`: equal, or `x[x]` answered by `x.ofType(T)`. HAPI
 * compares the paths with `[x]` stripped, so NZ Base's `Patient.deceased`
 * context names the choice element as well.
 */
export function namesElement(logicalPaths: readonly string[], expression: string): boolean {
  const expected = expression.split('.');
  return logicalPaths.some(path => {
    if (path === expression || path.replace(/\[x\]/g, '') === expression) return true;
    const actual = path.split('.');
    let a = 0;
    let e = 0;
    while (a < actual.length && e < expected.length) {
      if (actual[a] !== expected[e]) {
        const stem = expected[e].endsWith('[x]') ? expected[e].slice(0, -3) : null;
        if (stem === null || actual[a] !== stem || !actual[a + 1]?.startsWith('ofType(')) return false;
        a += 1;
      }
      a += 1;
      e += 1;
    }
    return a === actual.length && e === expected.length;
  });
}

function findChildDefinition(
  definitions: ElementDefinition[],
  parentPath: string,
  name: string,
): { element: ElementDefinition; choiceType?: string } | null {
  const unsliced = (element: ElementDefinition) => !element.sliceName && !(element.id ?? '').includes(':');
  const exact = definitions.find(element => element.path === `${parentPath}.${name}` && unsliced(element));
  if (exact) return { element: exact };
  for (const element of definitions) {
    if (!unsliced(element) || !element.path.startsWith(`${parentPath}.`) || !element.path.endsWith('[x]')) continue;
    const stem = element.path.slice(parentPath.length + 1, -3);
    if (stem.includes('.') || !name.startsWith(stem)) continue;
    const suffix = name.slice(stem.length);
    const choiceType = (element.type ?? [])
      .map(type => type.code)
      .find(code => code.toLowerCase() === suffix.toLowerCase());
    if (choiceType) return { element, choiceType };
  }
  return null;
}

/** HAPI NodeStack.isRealPath: abstract bases only own their own elements. */
function isRealPath(parent: string, name: string): boolean {
  if (parent === 'Element') return name === 'id' || name === 'extension';
  if (parent === 'BackboneElement' || parent === 'BackboneType') return name === 'modifierExtension';
  if (parent === 'Resource') return ['id', 'meta', 'implicitRules', 'language'].includes(name);
  if (parent === 'DomainResource') return ['text', 'contained', 'extension', 'modifierExtension'].includes(name);
  return true;
}

async function expandTypeHierarchy(paths: string[], lookup: TypeDefinitionLookup): Promise<string[]> {
  const expanded = new Set(paths);
  for (const path of paths) {
    const dot = path.indexOf('.');
    const head = dot < 0 ? path : path.slice(0, dot);
    const rest = dot < 0 ? '' : path.slice(dot);
    let name: string | undefined = head;
    for (let depth = 0; name && depth < MAX_TYPE_HIERARCHY_DEPTH; depth += 1) {
      const definition = await lookup(name);
      if (!definition) break;
      if (definition.type) expanded.add(`${definition.type}${rest}`);
      const base = definition.baseDefinition?.split('|')[0];
      const baseName = base?.slice(base.lastIndexOf('/') + 1);
      name = baseName && baseName !== name ? baseName : undefined;
    }
  }
  return [...expanded];
}

/** Resolves logical paths once per element path and FHIR version. */
export class ExtensionLogicalPathCache {
  private readonly resolved = new BoundedLruCache<string, readonly string[] | 'unresolved'>(1_024);

  constructor(private readonly sdLoader: Pick<StructureDefinitionLoader, 'loadProfile'>) {}

  async resolve(
    site: { resourceType: string; elementPath: string },
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<readonly string[] | null> {
    const key = `${fhirVersion}|${site.elementPath}`;
    const cached = this.resolved.get(key);
    if (cached) return cached === 'unresolved' ? null : cached;
    const lookup: TypeDefinitionLookup = async typeName => {
      try {
        return await this.sdLoader.loadProfile(`http://hl7.org/fhir/StructureDefinition/${typeName}`, fhirVersion) ?? null;
      } catch {
        return null;
      }
    };
    const paths = await resolveLogicalPaths(site.resourceType, site.elementPath, lookup);
    this.resolved.set(key, paths ?? 'unresolved');
    return paths;
  }
}
