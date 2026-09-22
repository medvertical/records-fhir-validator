/**
 * Reference Format Validator
 * 
 * Validates FHIR Reference.reference string format:
 * - Relative: ResourceType/id
 * - Absolute: http(s)://server/ResourceType/id
 * - Contained: #localId
 * - URN: urn:uuid:xxxx or urn:oid:xxxx
 * 
 * This validator ensures reference strings are well-formed according to FHIR specification.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';

// ============================================================================
// Reference Format Patterns
// ============================================================================

const REFERENCE_PATTERNS = {
    // Relative reference: ResourceType/id with optional /_history/version
    // FHIR id allows [A-Za-z0-9\-._] up to 64 chars
    relative: /^([A-Z][a-zA-Z]+)\/[A-Za-z0-9\-._]+(\/_history\/[A-Za-z0-9\-._]+)?$/,

    // Absolute reference: any http(s) URL. FHIR allows both literal
    // references (http://server/Patient/123) and opaque endpoint URLs
    // (http://example.org/endpoint). We only validate that it's a
    // well-formed URL, not that it resolves to a FHIR resource.
    absolute: /^https?:\/\/[^\s]+$/,

    // Contained reference: #localId or bare `#` (self-reference to the
    // resource that contains this one — valid FHIR). Accepts empty token
    // after '#' so self-references don't fail format validation; structural-
    // id validation handles truly invalid characters separately.
    contained: /^#.*$/,

    // URN UUID: urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    urnUuid: /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,

    // URN OID: urn:oid:x.x.x.x
    urnOid: /^urn:oid:[0-9]+(\.[0-9]+)*$/,

    // General URN: urn:<nid>:<nss> — matches any well-formed URN (RFC 8141)
    // so that near-valid uuid URNs (with trailing chars) are treated as
    // "reference not found" instead of "invalid format".
    urnGeneral: /^urn:[a-z0-9][a-z0-9-]{0,31}:.+$/i,

    // Conditional reference: ResourceType?search-params (used in transaction bundles)
    conditional: /^([A-Z][a-zA-Z]+)\?.+$/,

    // Opaque single-segment relative URL (no '/' and no scheme). RFC 3986
    // makes these valid relative references and the HL7 validator accepts
    // them (UK Core examples reference plain ids like
    // 'UKCore-Location-...-Example'). Mirrors isBareRelativeReference in
    // reference/reference-format-validator.ts.
    relativeOpaque: /^[A-Za-z0-9\-._~%]+$/,
};

// ============================================================================
// Reference Format Validator
// ============================================================================

export class ReferenceFormatValidator {
    /**
     * Validate a reference string format
     */
    validateReferenceString(
        reference: unknown,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!reference || typeof reference !== 'string') {
            return issues;
        }

        // Trim whitespace
        const ref = reference.trim();

        // Check against all valid patterns
        const isRelative = REFERENCE_PATTERNS.relative.test(ref);
        const isAbsolute = REFERENCE_PATTERNS.absolute.test(ref);
        const isContained = REFERENCE_PATTERNS.contained.test(ref);
        const isUrnUuid = REFERENCE_PATTERNS.urnUuid.test(ref);
        const isUrnOid = REFERENCE_PATTERNS.urnOid.test(ref);
        const isUrnGeneral = REFERENCE_PATTERNS.urnGeneral.test(ref) &&
            !ref.toLowerCase().startsWith('urn:uuid:');
        const isConditional = REFERENCE_PATTERNS.conditional.test(ref);
        const isRelativeOpaque = REFERENCE_PATTERNS.relativeOpaque.test(ref);

        const isValid = isRelative || isAbsolute || isContained || isUrnUuid || isUrnOid ||
            isUrnGeneral || isConditional || isRelativeOpaque;

        const onlyOpaqueMatched = isRelativeOpaque &&
            !(isRelative || isAbsolute || isContained || isUrnUuid || isUrnOid || isUrnGeneral || isConditional);
        if (onlyOpaqueMatched && isInsideBundleEntryResource(path)) {
            // Java parity: a bare single-segment token is a valid relative URL
            // on a standalone resource, but inside a Bundle entry it can never
            // resolve against entry fullUrls, so the HL7 validator rejects it
            // ("Relative URLs must be of the format [ResourceName]/[id]" —
            // see the bundle-ea-testcase baseline).
            issues.push(createValidationIssue({
                code: 'reference-invalid-bundle-relative',
                severityOverride: 'error',
                path: `${path}.reference`,
                resourceType,
                customMessage: `Relative URLs must be of the format [ResourceName]/[id]. Encountered ${ref}`,
                details: { reference: ref },
            }));
        }

        if (!isValid) {
            const isNonCanonicalUuidUrn = ref.toLowerCase().startsWith('urn:uuid:') && REFERENCE_PATTERNS.urnGeneral.test(ref);
            const severity = isNonCanonicalUuidUrn ? 'warning' : 'error';
            logger.debug(
                '[ReferenceFormatValidator] Invalid reference format',
                sensitiveValueMetadata(ref),
            );
            issues.push(createValidationIssue({
                code: 'reference-invalid-format',
                severityOverride: severity,
                path: `${path}.reference`,
                resourceType,
                customMessage: `Invalid reference format: '${ref}'. Expected ResourceType/id, absolute URL, #containedId, or urn:uuid/oid.`,
                details: {
                    reference: ref,
                    testedPatterns: ['relative', 'absolute', 'contained', 'urnUuid', 'urnOid']
                }
            }));
        }

        // Additional validation: check if resource type is valid (for relative references)
        if (isRelative) {
            const match = ref.match(REFERENCE_PATTERNS.relative);
            if (match && match[1]) {
                const refResourceType = match[1];
                if (!KNOWN_FHIR_RESOURCE_TYPES.has(refResourceType)) {
                    logger.debug(`[ReferenceFormatValidator] Unknown resource type in reference: ${refResourceType}`);
                    issues.push(createValidationIssue({
                        code: 'reference-type-unknown',
                        path: `${path}.reference`,
                        resourceType,
                        customMessage: `Unknown resource type in reference: '${refResourceType}'`,
                        details: {
                            reference: ref,
                            referencedResourceType: refResourceType
                        }
                    }));
                }
            }
        }

        return issues;
    }

    /**
     * Validate all Reference elements in a resource
     */
    validateAllReferences(
        resource: unknown,
        path: string = ''
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const record = asRecord(resource);
        const resourceType = typeof record?.resourceType === 'string'
            ? record.resourceType
            : 'Unknown';

        this.traverseAndValidate(resource, path || resourceType, resourceType, issues, new WeakSet());

        return issues;
    }

    /**
     * Recursively traverse resource and validate reference fields
     */
    private traverseAndValidate(
        obj: unknown,
        path: string,
        resourceType: string,
        issues: ValidationIssue[],
        visited: WeakSet<object>,
    ): void {
        if (obj === null || typeof obj !== 'object') return;
        if (visited.has(obj)) return;
        visited.add(obj);

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                this.traverseAndValidate(item, `${path}[${index}]`, resourceType, issues, visited);
            });
            return;
        }

        const record = asRecord(obj);
        if (!record) return;
        if (typeof record.reference === 'string' && !isFhirExpression(record)) {
            issues.push(...this.validateReferenceString(record.reference, path, resourceType));
        }

        for (const key of Object.keys(record)) {
            if (key === 'resourceType' || key === 'id' || key === 'meta') {
                continue;
            }
            this.traverseAndValidate(record[key], `${path}.${key}`, resourceType, issues, visited);
        }
    }
}

// Bundle.entry.resource is the only FHIR element pair where an `entry` node
// carries a `resource` child, so this path shape reliably identifies
// references that belong to a resource inside a Bundle entry — including
// bundles nested via contained resources.
function isInsideBundleEntryResource(path: string): boolean {
    return /\.entry\[\d+\]\.resource\./.test(path);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isFhirExpression(obj: Record<string, unknown>): boolean {
    if (typeof obj.reference !== 'string') return false;

    return typeof obj.language === 'string'
        || typeof obj.expression === 'string'
        || typeof obj.name === 'string'
        || typeof obj.description === 'string';
}
