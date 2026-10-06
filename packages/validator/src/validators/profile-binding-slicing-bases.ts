import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { fhirVersionFamily, type FhirVersionFamily } from '../core/sd-loader-version-utils.js';

interface Basis { element: ElementDefinition; index: number; identity: string }
interface PreparedBases { elements: ElementDefinition[]; ambiguousBaseIds: ReadonlySet<string> }

/** Element IDs are optional; snapshot order can supply an unambiguous own slicing basis. */
export function prepareProfileBindingSlicingBases(
  profile: StructureDefinition | undefined,
  family: FhirVersionFamily,
): PreparedBases {
  const elements = profile?.snapshot?.element ?? [];
  const empty = { elements, ambiguousBaseIds: new Set<string>() };
  if (!profile || profile.kind !== 'resource' || profile.abstract !== false
    || fhirVersionFamily({ resourceType: profile.resourceType, fhirVersion: profile.fhirVersion }) !== family) return empty;
  const roots = elements.filter(element => element.path === profile.type);
  if (roots.length !== 1 || roots[0].id !== profile.type || roots[0].sliceName !== undefined) return empty;
  const counts = new Map<string, number>();
  for (const element of elements) if (element.id) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
  if (counts.get(profile.type) !== 1) return empty;
  const groups = new Map<string, Basis[]>();
  for (const basis of collectBases(elements, profile.type, counts)) {
    const group = groups.get(basis.identity) ?? [];
    group.push(basis); groups.set(basis.identity, group);
  }
  const ambiguousBaseIds = new Set<string>();
  let prepared: ElementDefinition[] | undefined;
  for (const [identity, group] of groups) {
    if (group.length !== 1) { ambiguousBaseIds.add(identity); continue; }
    const basis = group[0];
    if (basis.element.id !== undefined || counts.has(identity)
      || !hasDirectDiscriminators(basis.element) || !hasCoherentSlices(basis, elements, counts)) continue;
    prepared ??= elements.slice();
    prepared[basis.index] = { ...basis.element, id: identity };
  }
  return { elements: prepared ?? elements, ambiguousBaseIds };
}

function collectBases(elements: ElementDefinition[], root: string, counts: ReadonlyMap<string, number>): Basis[] {
  const branch: ElementDefinition[] = [];
  const bases: Basis[] = [];
  for (const [index, element] of elements.entries()) {
    while (branch.length && !element.path.startsWith(`${branch.at(-1)!.path}.`)) branch.pop();
    if (element.slicing && element.sliceName === undefined && element.path.startsWith(`${root}.`)) {
      const identity = branchBaseIdentity(branch, element.path, root, counts);
      if (identity) bases.push({ element, index, identity });
    }
    branch.push(element);
  }
  return bases;
}

function branchBaseIdentity(
  branch: ElementDefinition[], path: string, root: string, counts: ReadonlyMap<string, number>,
): string | undefined {
  if (branch[0]?.path !== root || branch[0].id !== root) return undefined;
  let owner: ElementDefinition | undefined;
  for (const parent of branch.slice(1)) {
    const identity = owner ? `${owner.id}${parent.path.slice(owner.path.length)}` : parent.path;
    if (parent.sliceName !== undefined) {
      if (!isOwnSlice(parent, root, counts) || parent.id !== `${identity}:${parent.sliceName}`) return undefined;
      owner = parent;
    } else if (parent.id !== identity || counts.get(identity) !== 1) return undefined;
  }
  return owner ? `${owner.id}${path.slice(owner.path.length)}` : path;
}

function isOwnSlice(element: ElementDefinition, root: string, counts: ReadonlyMap<string, number>): boolean {
  const name = element.sliceName;
  return typeof name === 'string' && name.length > 0 && !/[.:/]/.test(name)
    && typeof element.id === 'string' && counts.get(element.id) === 1
    && element.id.startsWith(`${root}.`) && element.id.endsWith(`:${name}`)
    && element.id.split('.').map(segment => segment.split(':')[0]).join('.') === element.path;
}

function hasDirectDiscriminators(element: ElementDefinition): boolean {
  const discriminators = element.slicing?.discriminator;
  return Array.isArray(discriminators) && discriminators.length > 0 && discriminators.every(discriminator =>
    (discriminator.type === 'value' || discriminator.type === 'pattern')
    && typeof discriminator.path === 'string'
    && /^(?:\$this|[A-Za-z]\w*(?:\.[A-Za-z]\w*)*)$/.test(discriminator.path));
}

function hasCoherentSlices(basis: Basis, elements: ElementDefinition[], counts: ReadonlyMap<string, number>): boolean {
  let found = false;
  for (const element of elements.slice(basis.index + 1)) {
    if (element.path !== basis.element.path && !element.path.startsWith(`${basis.element.path}.`)) break;
    if (element.path !== basis.element.path) continue;
    if (!isOwnSlice(element, basis.element.path.split('.')[0], counts)
      || element.id !== `${basis.identity}:${element.sliceName}`) return false;
    found = true;
  }
  return found;
}
