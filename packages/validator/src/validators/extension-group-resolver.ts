export type GetValueAtPath = (resource: any, path: string) => any;

/**
 * Get extension arrays grouped by parent element instance.
 *
 * For paths like `Account.coverage.extension`, if `coverage` is an array,
 * returns one group per coverage item. Cardinality constraints apply per
 * group, not globally across the flattened array.
 */
export function getExtensionGroupsByParent(
  resource: any,
  elementPath: string,
  getValueAtPath: GetValueAtPath,
): any[][] {
  const lastDot = elementPath.lastIndexOf('.');
  if (lastDot <= 0) {
    const rawValue = getValueAtPath(resource, elementPath);
    return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
  }

  const parentPath = elementPath.substring(0, lastDot);
  const leafKey = elementPath.substring(lastDot + 1);

  const primitiveSidecarGroups = getPrimitiveExtensionGroups(resource, parentPath, leafKey);
  if (primitiveSidecarGroups) return primitiveSidecarGroups;

  const parentRaw = getValueAtPath(resource, parentPath);
  if (parentRaw == null) return [];

  const parents = Array.isArray(parentRaw) ? parentRaw : [parentRaw];
  const groups: any[][] = [];

  for (const parent of parents) {
    if (parent == null || typeof parent !== 'object') continue;
    const exts = parent[leafKey];
    if (Array.isArray(exts)) {
      groups.push(exts);
    } else if (exts != null) {
      groups.push([exts]);
    } else {
      groups.push([]);
    }
  }

  if (groups.length === 0) {
    const rawValue = getValueAtPath(resource, elementPath);
    return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
  }

  return groups;
}

function getPrimitiveExtensionGroups(
  resource: any,
  parentPath: string,
  leafKey: string
): any[][] | null {
  if (leafKey !== 'extension' && leafKey !== 'modifierExtension') return null;

  const parentLastDot = parentPath.lastIndexOf('.');
  if (parentLastDot <= 0) return null;

  const containerPath = parentPath.substring(0, parentLastDot);
  const primitiveKey = parentPath.substring(parentLastDot + 1);
  if (!primitiveKey || primitiveKey.startsWith('_')) return null;

  const containers = getValuesAtPath(resource, containerPath);
  const groups: any[][] = [];
  let foundPrimitiveParent = false;

  for (const container of containers) {
    if (container == null || typeof container !== 'object' || Array.isArray(container)) continue;
    if (!(primitiveKey in container)) continue;

    foundPrimitiveParent = true;
    const primitiveValue = container[primitiveKey];
    const sidecar = container[`_${primitiveKey}`];

    if (Array.isArray(primitiveValue)) {
      for (let i = 0; i < primitiveValue.length; i++) {
        const sidecarItem = Array.isArray(sidecar) ? sidecar[i] : sidecar;
        groups.push(getExtensionGroupFromSidecar(sidecarItem, leafKey));
      }
    } else {
      groups.push(getExtensionGroupFromSidecar(sidecar, leafKey));
    }
  }

  return foundPrimitiveParent ? groups : null;
}

function getExtensionGroupFromSidecar(sidecar: any, leafKey: string): any[] {
  if (sidecar == null || typeof sidecar !== 'object') return [];
  const exts = sidecar[leafKey];
  if (Array.isArray(exts)) return exts;
  return exts != null ? [exts] : [];
}

function getValuesAtPath(resource: any, path: string): any[] {
  if (!path) return [resource];
  const segments = path
    .split('.')
    .filter(Boolean)
    .filter((segment, index) => !(index === 0 && segment === resource?.resourceType));

  const walk = (value: any, index: number): any[] => {
    if (value == null) return [];
    if (index >= segments.length) return Array.isArray(value) ? value : [value];
    if (Array.isArray(value)) return value.flatMap(item => walk(item, index));

    if (typeof value !== 'object') return [];
    const segment = segments[index];
    let next = value[segment];

    if (next === undefined && segment.endsWith('[x]')) {
      const prefix = segment.slice(0, -3);
      const actualKey = Object.keys(value).find(k => k.startsWith(prefix) && k !== segment);
      if (actualKey) next = value[actualKey];
    }

    return walk(next, index + 1);
  };

  return walk(resource, 0);
}
