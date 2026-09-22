import type {
  BundleEntry,
  BundleReference,
  FhirResourceRecord,
  ResourceReference,
} from './bundle-reference-types.js';
import { assertFhirObjectTraversalCapacity } from '../utils/object-traversal-limit.js';

export function extractBundleEntries(bundle: unknown): BundleEntry[] {
  const bundleRecord = toRecord(bundle);
  if (bundleRecord?.resourceType !== 'Bundle') {
    return [];
  }

  if (!Array.isArray(bundleRecord.entry)) {
    return [];
  }

  return bundleRecord.entry.map(toBundleEntry);
}

export function findAllBundleReferences(bundle: unknown): BundleReference[] {
  const references: BundleReference[] = [];
  const entries = extractBundleEntries(bundle);

  entries.forEach((entry, index) => {
    if (!entry.resource) return;

    const resourceRefs = findReferencesInResource(entry.resource);
    resourceRefs.forEach(ref => {
      references.push({
        ...ref,
        entryIndex: index,
        sourceResourceType: getString(entry.resource, 'resourceType'),
      });
    });
  });

  return references;
}

export function findReferencesInResource(
  resource: unknown,
  fieldPath: string = '',
  options: { includeContained?: boolean } = {},
): ResourceReference[] {
  const references: ResourceReference[] = [];
  const pending: Array<{ value: unknown; path: string }> = [{ value: resource, path: fieldPath }];
  const visited = new WeakSet<object>();
  let processed = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !current.value || typeof current.value !== 'object') {
      continue;
    }
    if (visited.has(current.value)) continue;
    assertFhirObjectTraversalCapacity(processed, 'reference');
    visited.add(current.value);
    processed++;

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({ value: current.value[index], path: `${current.path}[${index}]` });
      }
      continue;
    }

    const record = current.value as FhirResourceRecord;
    if (typeof record.reference === 'string' && !isFhirExpression(record)) {
      references.push({
        reference: record.reference,
        fieldPath: current.path ? `${current.path}.reference` : 'reference',
      });
    }

    const entries = Object.entries(record);
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (key === 'contained' && !options.includeContained) continue;
      pending.push({
        value,
        path: current.path ? `${current.path}.${key}` : key,
      });
    }
  }

  return references;
}

function toBundleEntry(value: unknown): BundleEntry {
  const record = toRecord(value);
  if (!record) return {};
  const request = toRecord(record.request);
  const response = toRecord(record.response);
  return {
    fullUrl: getString(record, 'fullUrl'),
    resource: toRecord(record.resource) ?? undefined,
    request: request ? {
      method: getString(request, 'method'),
      url: getString(request, 'url'),
    } : undefined,
    response: response && getString(response, 'status') ? {
      status: getString(response, 'status') as string,
      location: getString(response, 'location'),
    } : undefined,
  };
}

function toRecord(value: unknown): FhirResourceRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as FhirResourceRecord
    : null;
}

function getString(record: FhirResourceRecord | undefined | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function isFhirExpression(record: FhirResourceRecord): boolean {
  return typeof record.reference === 'string' && (
    typeof record.language === 'string'
    || typeof record.expression === 'string'
    || typeof record.name === 'string'
    || typeof record.description === 'string'
  );
}
