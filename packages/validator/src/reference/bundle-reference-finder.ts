import type { BundleEntry, BundleReference, ResourceReference } from './bundle-reference-types';

export function extractBundleEntries(bundle: any): BundleEntry[] {
  if (!bundle || bundle.resourceType !== 'Bundle') {
    return [];
  }

  if (!Array.isArray(bundle.entry)) {
    return [];
  }

  return bundle.entry;
}

export function findAllBundleReferences(bundle: any): BundleReference[] {
  const references: BundleReference[] = [];
  const entries = extractBundleEntries(bundle);

  entries.forEach((entry, index) => {
    if (!entry.resource) return;

    const resourceRefs = findReferencesInResource(entry.resource);
    resourceRefs.forEach(ref => {
      references.push({
        ...ref,
        entryIndex: index,
        sourceResourceType: entry.resource?.resourceType,
      });
    });
  });

  return references;
}

export function findReferencesInResource(resource: any, fieldPath: string = ''): ResourceReference[] {
  const references: ResourceReference[] = [];

  if (!resource || typeof resource !== 'object') {
    return references;
  }

  if (resource.reference && typeof resource.reference === 'string') {
    references.push({
      reference: resource.reference,
      fieldPath: fieldPath ? `${fieldPath}.reference` : 'reference',
    });
  }

  for (const [key, value] of Object.entries(resource)) {
    if (key === 'contained') {
      continue;
    }

    const newPath = fieldPath ? `${fieldPath}.${key}` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        references.push(...findReferencesInResource(item, `${newPath}[${index}]`));
      });
    } else if (value && typeof value === 'object') {
      references.push(...findReferencesInResource(value, newPath));
    }
  }

  return references;
}
