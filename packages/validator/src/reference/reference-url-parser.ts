import type { ReferenceParseResult } from './reference-type-extractor-types.js';
import {
  KNOWN_FHIR_RESOURCE_TYPES,
  KNOWN_FHIR_RESOURCE_TYPES_BY_LOWERCASE,
  isFhirVersionPathSegment,
} from './reference-resource-types.js';

export function parseAbsoluteReference(
  reference: string,
  validateKnownResourceType: boolean,
): ReferenceParseResult {
  try {
    const url = new URL(reference);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const fhirIndex = pathParts.findIndex(part => part.toLowerCase() === 'fhir');

    if (fhirIndex >= 0 && fhirIndex < pathParts.length - 1) {
      const resourceTypeIndex = isFhirVersionPathSegment(pathParts[fhirIndex + 1])
        ? fhirIndex + 2
        : fhirIndex + 1;
      const resourceType = normalizeAbsoluteResourceType(pathParts[resourceTypeIndex]);
      const resourceId = pathParts[resourceTypeIndex + 1];
      const version = pathParts[resourceTypeIndex + 2] === '_history'
        ? pathParts[resourceTypeIndex + 3]
        : undefined;
      const isValidType = !!resourceType
        && isValidResourceType(resourceType, validateKnownResourceType);
      return {
        resourceType: isValidType ? resourceType : null,
        resourceId: resourceId || null,
        referenceType: 'absolute',
        isValid: true,
        originalReference: reference,
        baseUrl: `${url.origin}/${pathParts.slice(0, resourceTypeIndex).join('/')}`.replace(/\/$/, ''),
        version,
        metadata: { isHistorical: !!version, hasVersion: !!version },
      };
    }

    if (pathParts.length >= 4 && pathParts[pathParts.length - 2] === '_history') {
      const resourceType = normalizeAbsoluteResourceType(pathParts[pathParts.length - 4]);
      const resourceId = pathParts[pathParts.length - 3];
      const version = pathParts[pathParts.length - 1];
      const isValidType = !!resourceType
        && isValidResourceType(resourceType, validateKnownResourceType);
      return {
        resourceType: isValidType ? resourceType : null,
        resourceId,
        referenceType: 'absolute',
        isValid: true,
        originalReference: reference,
        baseUrl: `${url.origin}/${pathParts.slice(0, -4).join('/')}`.replace(/\/$/, ''),
        version,
        metadata: { isHistorical: true, hasVersion: true },
      };
    }

    if (pathParts.length >= 2) {
      const resourceType = normalizeAbsoluteResourceType(pathParts[pathParts.length - 2]);
      const isValidType = !!resourceType
        && isValidResourceType(resourceType, validateKnownResourceType);
      return {
        resourceType: isValidType ? resourceType : null,
        resourceId: pathParts[pathParts.length - 1],
        referenceType: 'absolute',
        isValid: true,
        originalReference: reference,
        baseUrl: url.origin,
      };
    }

    return {
      resourceType: null,
      resourceId: null,
      referenceType: 'absolute',
      isValid: true,
      originalReference: reference,
      baseUrl: url.origin,
      metadata: { isHistorical: false, hasVersion: false },
    };
  } catch (error) {
    return invalidResult(reference, `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function parseCanonicalReference(
  reference: string,
  options: { allowCanonical: boolean; validateKnownResourceType: boolean },
): ReferenceParseResult {
  try {
    const [baseUrl, version] = reference.split('|');
    const url = new URL(baseUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    let resourceType: string | null = null;
    if (pathParts.length >= 2) {
      const candidate = pathParts[pathParts.length - 2];
      if (isValidResourceType(candidate, options.validateKnownResourceType)) resourceType = candidate;
    }
    if (!resourceType) {
      resourceType = pathParts.find(part => isValidResourceType(part, options.validateKnownResourceType)) ?? null;
    }
    if (!options.allowCanonical) return invalidResult(reference, 'Canonical references not allowed');
    return {
      resourceType,
      resourceId: pathParts[pathParts.length - 1] || null,
      referenceType: 'canonical',
      isValid: !!resourceType,
      originalReference: reference,
      baseUrl: url.origin,
      version: version?.trim() || undefined,
      metadata: { hasVersion: !!version },
    };
  } catch (error) {
    return invalidResult(reference, `Invalid canonical URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function normalizeAbsoluteResourceType(resourceType: string | undefined): string | null {
  if (!resourceType) return null;
  return KNOWN_FHIR_RESOURCE_TYPES_BY_LOWERCASE.get(resourceType.toLowerCase()) ?? resourceType;
}

function isValidResourceType(resourceType: string, validateKnown: boolean): boolean {
  if (isFhirVersionPathSegment(resourceType)) return false;
  return validateKnown
    ? KNOWN_FHIR_RESOURCE_TYPES.has(resourceType)
    : /^[A-Z][a-zA-Z0-9]*$/.test(resourceType);
}

function invalidResult(reference: string, reason: string): ReferenceParseResult {
  return {
    resourceType: null,
    resourceId: null,
    referenceType: 'invalid',
    isValid: false,
    originalReference: reference,
    metadata: { error: reason },
  };
}
