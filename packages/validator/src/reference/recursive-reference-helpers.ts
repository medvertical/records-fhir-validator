import { logger } from '../logger';
import { parseReference } from './reference-type-extractor';

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
  resource: any,
  parentResourceId: string,
  depth: number,
): ReferenceToValidate[] {
  const references: ReferenceToValidate[] = [];

  if (!resource || typeof resource !== 'object') {
    return references;
  }

  extractReferencesFromObject(resource, '', parentResourceId, depth, references);

  return references;
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

  const maxRefs = context.config.maxReferencesPerResource || 10;
  if (filtered.length > maxRefs) {
    logger.debug(
      `[RecursiveReferenceValidator] Limiting references from ${filtered.length} to ${maxRefs}`,
    );
    filtered = filtered.slice(0, maxRefs);
  }

  return filtered;
}

export function resolveContainedReference(resource: any, reference: string): any | null {
  if (!reference.startsWith('#') || reference === '#') return null;
  if (!Array.isArray(resource?.contained)) return null;

  const containedId = reference.slice(1);
  return resource.contained.find((contained: any) =>
    contained && String(contained.id) === containedId,
  ) ?? null;
}

export function resolveBundleReference(resource: any, reference: string): any | null {
  if (resource?.resourceType !== 'Bundle' || !Array.isArray(resource.entry)) return null;

  for (const entry of resource.entry) {
    const entryResource = entry?.resource;
    if (!entryResource || typeof entryResource !== 'object') continue;
    if (entry.fullUrl === reference) return entryResource;
    if (
      entryResource.resourceType &&
      entryResource.id &&
      reference === `${entryResource.resourceType}/${entryResource.id}`
    ) {
      return entryResource;
    }
  }

  return null;
}

export function getResourceIdentifier(resource: any): string {
  if (!resource || typeof resource !== 'object') {
    return `unknown-${Date.now()}-${Math.random()}`;
  }
  if (resource.resourceType && resource.id) {
    return `${resource.resourceType}/${resource.id}`;
  }
  if (resource.id) {
    return resource.id;
  }
  return `unknown-${Date.now()}-${Math.random()}`;
}

export function isTimeoutReached(context: RecursiveReferenceFilterContext): boolean {
  const elapsed = Date.now() - context.startTime;
  const timeout = context.config.timeoutMs || 30000;
  return elapsed >= timeout;
}

function extractReferencesFromObject(
  obj: any,
  path: string,
  parentResourceId: string,
  depth: number,
  references: ReferenceToValidate[],
): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (obj.reference && typeof obj.reference === 'string') {
    const parseResult = parseReference(obj.reference);

    references.push({
      reference: obj.reference,
      resourceType: parseResult.resourceType || undefined,
      resourceId: parseResult.resourceId || undefined,
      fieldPath: path || 'reference',
      parentResourceId,
      depth,
    });
  }

  for (const [key, value] of Object.entries(obj)) {
    const newPath = path ? `${path}.${key}` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        extractReferencesFromObject(
          item,
          `${newPath}[${index}]`,
          parentResourceId,
          depth,
          references,
        );
      });
    } else if (value && typeof value === 'object') {
      extractReferencesFromObject(value, newPath, parentResourceId, depth, references);
    }
  }
}
