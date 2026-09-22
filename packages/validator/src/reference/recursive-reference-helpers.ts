import { logger } from '../logger.js';
import { parseReference } from './reference-type-extractor.js';
import {
  extractBundleEntries,
  findReferencesInResource,
} from './bundle-reference-finder.js';

interface RecursiveReferenceFilterContext {
  startTime: number;
  config: {
    validateExternal: boolean;
    validateContained: boolean;
    excludeResourceTypes?: string[];
    maxReferencesPerResource?: number;
    timeoutMs?: number;
  };
}

export interface ReferenceToValidate {
  /** The reference string */
  reference: string;
  /** Resource type if known */
  resourceType?: string;
  /** Resource ID if known */
  resourceId?: string;
  /** Field path where reference was found */
  fieldPath: string;
  /** Parent resource ID */
  parentResourceId: string;
  /** Depth in validation chain */
  depth: number;
}

export function extractReferencesToValidate(
  resource: unknown,
  parentResourceId: string,
  depth: number,
): ReferenceToValidate[] {
  return findReferencesInResource(resource, '', { includeContained: true }).map(
    ({ reference, fieldPath }) => {
      const parseResult = parseReference(reference);
      return {
        reference,
        resourceType: parseResult.resourceType || undefined,
        resourceId: parseResult.resourceId || undefined,
        fieldPath: fieldPath.endsWith('.reference')
          ? fieldPath.slice(0, -'.reference'.length)
          : fieldPath,
        parentResourceId,
        depth,
      };
    },
  );
}

export function filterReferences(
  references: ReferenceToValidate[],
  context: RecursiveReferenceFilterContext,
): ReferenceToValidate[] {
  let filtered = references;

  if (context.config.excludeResourceTypes && context.config.excludeResourceTypes.length > 0) {
    filtered = filtered.filter(
      ref => !ref.resourceType || !context.config.excludeResourceTypes!.includes(ref.resourceType),
    );
  }

  if (!context.config.validateExternal) {
    filtered = filtered.filter(ref => {
      const parseResult = parseReference(ref.reference);
      return parseResult.referenceType !== 'absolute' && parseResult.referenceType !== 'canonical';
    });
  }

  if (!context.config.validateContained) {
    filtered = filtered.filter(ref => !ref.reference.startsWith('#'));
  }

  filtered = Array.from(
    new Map(filtered.map((reference) => [reference.reference, reference])).values(),
  );

  const maxRefs = context.config.maxReferencesPerResource || 10;
  if (filtered.length > maxRefs) {
    logger.debug(
      `[RecursiveReferenceValidator] Limiting references from ${filtered.length} to ${maxRefs}`,
    );
    filtered = filtered.slice(0, maxRefs);
  }

  return filtered;
}

export function resolveContainedReference(
  resource: unknown,
  reference: string,
): Record<string, unknown> | null {
  if (!reference.startsWith('#') || reference === '#') return null;
  const contained = toRecord(resource)?.contained;
  if (!Array.isArray(contained)) return null;

  const containedId = reference.slice(1);
  for (const candidate of contained) {
    const record = toRecord(candidate);
    if (record && record.id === containedId) return record;
  }
  return null;
}

export function resolveBundleReference(
  resource: unknown,
  reference: string,
): Record<string, unknown> | null {
  for (const entry of extractBundleEntries(resource)) {
    const entryResource = entry.resource;
    if (!entryResource) continue;
    if (entry.fullUrl === reference) return entryResource;
    const resourceType = getString(entryResource, 'resourceType');
    const resourceId = getString(entryResource, 'id');
    if (resourceType && resourceId && reference === `${resourceType}/${resourceId}`) {
      return entryResource;
    }
  }

  return null;
}

export class ResourceIdentityRegistry {
  private readonly anonymousResourceIds = new WeakMap<object, string>();
  private anonymousResourceSequence = 0;

  getIdentifier(resource: unknown): string {
    const record = toRecord(resource);
    if (!record) return 'unknown-scalar';
    const resourceType = getString(record, 'resourceType');
    const resourceId = getString(record, 'id');
    if (resourceType && resourceId) return `${resourceType}/${resourceId}`;
    if (resourceId) return resourceId;
    const existing = this.anonymousResourceIds.get(record);
    if (existing) return existing;
    const identifier = `unknown-object-${++this.anonymousResourceSequence}`;
    this.anonymousResourceIds.set(record, identifier);
    return identifier;
  }
}

export function getResourceIdentifier(
  resource: unknown,
  identities: ResourceIdentityRegistry,
): string {
  return identities.getIdentifier(resource);
}

export function isTimeoutReached(context: RecursiveReferenceFilterContext): boolean {
  const elapsed = Date.now() - context.startTime;
  const timeout = context.config.timeoutMs || 30000;
  return elapsed >= timeout;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
