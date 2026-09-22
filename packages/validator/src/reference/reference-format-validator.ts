/**
 * Reference Format Validator
 * 
 * Validates the format and structure of FHIR references.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ReferenceFormatValidation } from './reference-types.js';
import { KNOWN_FHIR_RESOURCE_TYPES_BY_LOWERCASE } from './reference-resource-types.js';
import { findReferencesInResource } from './bundle-reference-finder.js';
import { createReferenceValidationIssue } from './reference-utils.js';

export interface ReferenceFormatContext {
  path?: string;
  resourceType?: string;
}

const UUID_URN_PATTERN =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OID_URN_PATTERN = /^urn:oid:[0-9]+(?:\.[0-9]+)*$/;
const GENERAL_URN_PATTERN = /^urn:[a-z0-9][a-z0-9-]{0,31}:.+$/i;

function extractInstanceReferenceFromPath(pathname: string): {
  resourceType?: string;
  resourceId?: string;
  version?: string;
} {
  const pathParts = pathname.split('/').filter(p => p);
  if (pathParts.length < 2) return {};

  if (pathParts.length >= 4 && pathParts[pathParts.length - 2] === '_history') {
    return {
      resourceType: normalizeResourceType(pathParts[pathParts.length - 4]),
      resourceId: pathParts[pathParts.length - 3],
      version: pathParts[pathParts.length - 1],
    };
  }

  return {
    resourceType: normalizeResourceType(pathParts[pathParts.length - 2]),
    resourceId: pathParts[pathParts.length - 1],
  };
}

function normalizeResourceType(resourceType: string | undefined): string | undefined {
  if (!resourceType) return undefined;
  return KNOWN_FHIR_RESOURCE_TYPES_BY_LOWERCASE.get(resourceType.toLowerCase());
}

// ============================================================================
// Reference Format Validation
// ============================================================================

/**
 * Validate reference format and extract components
 */
export function validateReferenceFormat(
  reference: unknown,
  context: ReferenceFormatContext = {},
): ReferenceFormatValidation {
  const issues: ValidationIssue[] = [];
  let referenceType: 'relative' | 'absolute' | 'logical' | 'contained' | 'invalid' = 'invalid';
  let resourceType: string | undefined;
  let resourceId: string | undefined;
  let version: string | undefined;

  if (typeof reference !== 'string' || reference.trim() === '') {
    issues.push(createFormatIssue({
      code: 'empty-reference',
      message: 'Reference cannot be empty',
      humanReadable: 'The reference field is empty',
      reference,
      context,
    }));
    return { isValid: false, referenceType: 'invalid', issues };
  }
  const normalizedReference = reference.trim();

  // Contained reference: #id
  if (normalizedReference.startsWith('#')) {
    referenceType = 'contained';
    resourceId = normalizedReference.substring(1);
    if (resourceId && !isValidFhirId(resourceId)) {
      issues.push(createFormatIssue({
        code: 'invalid-contained-reference',
        message: `Invalid contained reference: ${normalizedReference}`,
        humanReadable: 'Contained reference format: #id',
        reference: normalizedReference,
        context,
      }));
      return { isValid: false, referenceType: 'contained', issues };
    }
    return { isValid: true, referenceType: 'contained', resourceId, issues };
  }

  // Absolute URL reference
  if (normalizedReference.startsWith('http://') || normalizedReference.startsWith('https://')) {
    referenceType = 'absolute';

    try {
      const url = new URL(normalizedReference);
      ({ resourceType, resourceId, version } = extractInstanceReferenceFromPath(url.pathname));
    } catch (error) {
      issues.push(createFormatIssue({
        code: 'invalid-reference-url',
        message: `Invalid URL in reference: ${normalizedReference}`,
        humanReadable: 'The reference URL is malformed',
        reference: normalizedReference,
        context,
        details: { error: String(error) },
      }));
      return { isValid: false, referenceType: 'absolute', issues };
    }

    return { isValid: true, referenceType: 'absolute', resourceType, resourceId, version, issues };
  }

  // Logical identifier (urn:uuid: or urn:oid:)
  if (normalizedReference.toLowerCase().startsWith('urn:')) {
    if (isValidLogicalUrn(normalizedReference)) {
      return { isValid: true, referenceType: 'logical', issues };
    }
    issues.push(createFormatIssue({
      code: 'invalid-reference-format',
      message: `Invalid logical reference format: ${normalizedReference}`,
      humanReadable: 'Logical references must be valid urn:uuid, urn:oid, or general URNs',
      reference: normalizedReference,
      context,
      severity: isMalformedUuidUrn(normalizedReference) ? 'warning' : 'error',
    }));
    return { isValid: false, referenceType: 'logical', issues };
  }

  // Conditional reference: ResourceType?search-params (used in transaction bundles)
  if (/^[A-Z][a-zA-Z]+\?.+$/.test(normalizedReference)) {
    referenceType = 'relative'; // conditional refs are a form of relative reference
    resourceType = normalizedReference.split('?')[0];
    return { isValid: true, referenceType, resourceType, issues };
  }

  // Relative reference: ResourceType/id or ResourceType/id/_history/version.
  // Real-world IG examples sometimes use underscores in logical example ids;
  // keep this aligned with the broader ReferenceTypeExtractor parser.
  const relativePattern =
    /^([A-Z][a-zA-Z]+)\/([A-Za-z0-9\-._]{1,64})(?:\/_history\/([A-Za-z0-9\-._]{1,64}))?$/;
  const match = normalizedReference.match(relativePattern);

  if (match) {
    referenceType = 'relative';
    resourceType = match[1];
    resourceId = match[2];
    version = match[3];

    return { isValid: true, referenceType: 'relative', resourceType, resourceId, version, issues };
  }

  if (isBareRelativeReference(normalizedReference)) {
    return {
      isValid: true,
      referenceType: 'relative',
      resourceId: normalizedReference,
      issues,
    };
  }

  issues.push(createFormatIssue({
    code: 'invalid-reference-format',
    message: `Invalid reference format: ${normalizedReference}`,
    humanReadable:
      'Reference must be ResourceType/id, an absolute URL, #containedId, or a valid URN',
    reference: normalizedReference,
    context,
  }));

  return { isValid: false, referenceType: 'invalid', issues };
}

function createFormatIssue(input: {
  code: string;
  message: string;
  humanReadable: string;
  reference: unknown;
  context: ReferenceFormatContext;
  severity?: 'error' | 'warning';
  details?: Record<string, unknown>;
}): ValidationIssue {
  return createReferenceValidationIssue({
    code: input.code,
    severity: input.severity ?? 'error',
    message: input.message,
    humanReadable: input.humanReadable,
    path: input.context.path,
    resourceType: input.context.resourceType,
    details: {
      reference: toSafeReferenceDetail(input.reference),
      ...input.details,
    },
  });
}

function toSafeReferenceDetail(reference: unknown): string {
  if (typeof reference === 'string') return reference;
  if (reference === null) return 'null';
  if (reference === undefined) return 'undefined';
  if (typeof reference === 'symbol') return reference.description ?? 'symbol';
  try {
    return String(reference);
  } catch {
    return '[unprintable reference]';
  }
}

function isValidLogicalUrn(reference: string): boolean {
  if (UUID_URN_PATTERN.test(reference) || OID_URN_PATTERN.test(reference)) return true;
  return !reference.toLowerCase().startsWith('urn:uuid:')
    && GENERAL_URN_PATTERN.test(reference);
}

function isMalformedUuidUrn(reference: string): boolean {
  return reference.toLowerCase().startsWith('urn:uuid:')
    && GENERAL_URN_PATTERN.test(reference);
}

function isValidFhirId(value: string): boolean {
  return /^[A-Za-z0-9\-._]{1,64}$/.test(value);
}

function isBareRelativeReference(reference: string): boolean {
  if (reference.includes('/')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) return false;
  return /^[A-Za-z0-9\-._~%]+$/.test(reference);
}

/**
 * Extract all references from a resource
 */
export function extractReferences(
  resource: unknown,
  resourceType: string,
): Array<{ path: string; reference: string }> {
  return findReferencesInResource(resource, resourceType, { includeContained: true })
    .map(({ fieldPath, reference }) => ({
      path: fieldPath.endsWith('.reference')
        ? fieldPath.slice(0, -'.reference'.length)
        : fieldPath,
      reference,
    }));
}
