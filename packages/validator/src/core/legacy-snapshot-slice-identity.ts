import type { ElementDefinition } from './structure-definition-types.js';

function unslicedIdentity(identity: string): string {
  return identity.split('.').map(segment => segment.split(':')[0]).join('.');
}

function isOwnedSlice(
  element: ElementDefinition,
  resourceType: string,
  identities: ReadonlyMap<string, number>,
): boolean {
  return typeof element.id === 'string' && identities.get(element.id) === 1
    && typeof element.sliceName === 'string' && element.sliceName.length > 0
    && element.id.startsWith(`${resourceType}.`)
    && element.id.endsWith(`:${element.sliceName}`)
    && unslicedIdentity(element.id) === element.path;
}

function legacyIdentityMatchesBranch(
  element: ElementDefinition,
  branch: readonly ElementDefinition[],
): boolean {
  const identity = element.id!;
  const separator = identity.indexOf('.');
  if (separator < 1) return false;
  const legacyType = identity.slice(0, separator);
  const childPath = unslicedIdentity(identity.slice(separator + 1));
  if (legacyType === 'Element' && (childPath === 'id' || childPath === 'extension')) {
    return element.path.endsWith(`.${childPath}`);
  }
  return branch.some(parent => parent.type?.some(type => type.code === legacyType)
    && element.path === `${parent.path}.${childPath}`);
}

/** Older snapshots retain datatype IDs inside slices; order supplies the missing owner. */
export function normalizeLegacySnapshotSliceChildren(
  elements: ElementDefinition[],
  resourceType: string,
): ElementDefinition[] {
  const identities = new Map<string, number>();
  for (const element of elements) {
    if (element?.id) identities.set(element.id, (identities.get(element.id) ?? 0) + 1);
  }
  const branch: ElementDefinition[] = [];
  let normalized: ElementDefinition[] | undefined;
  for (const [index, element] of elements.entries()) {
    if (!element || typeof element.path !== 'string') { branch.length = 0; continue; }
    while (branch.length && !element.path.startsWith(`${branch.at(-1)!.path}.`)) branch.pop();
    const owners = branch.filter(parent => parent.sliceName);
    const owner = owners.at(-1);
    const coherentOwners = owners.every((parent, ownerIndex) => isOwnedSlice(parent, resourceType, identities)
      && (!ownerIndex || parent.id!.startsWith(`${owners[ownerIndex - 1].id}.`)));
    const coherentBranch = !owner || branch.every(parent => !parent.id?.startsWith(`${resourceType}.`)
      || parent.path.length <= owner.path.length || parent.id.startsWith(`${owner.id}.`));
    if (owner && coherentOwners && coherentBranch && typeof element.id === 'string'
      && !element.id.startsWith(`${resourceType}.`) && !element.sliceName
      && legacyIdentityMatchesBranch(element, branch)) {
      const identity = `${owner.id}${element.path.slice(owner.path.length)}`;
      if (!identities.has(identity)) {
        normalized ??= elements.slice();
        normalized[index] = { ...element, id: identity };
        identities.set(identity, 1);
      }
    }
    branch.push(normalized?.[index] ?? element);
  }
  return normalized ?? elements;
}
