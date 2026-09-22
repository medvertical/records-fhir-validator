
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';

/**
 * Paths where the FHIR spec explicitly allows relative URIs.
 * These use `uri` type in the SD but are not required to be absolute.
 */
const RELATIVE_URI_PATHS = new Set([
    'StructureDefinition.type', // Core definitions use type names/element paths such as Patient or Address.city
    'meta.source', // Meta.source is a uri and may be a relative source reference
    'coding.system', // Coding.system is validated terminologically; Java reports unknown systems rather than structural URI errors
    'expression.reference', // Expression.reference is a uri that commonly points at relative CQL artifacts
    'parameter.value[x]', // ValueSet.expansion.parameter.valueUri is a primitive uri and can be relative
    'request.url',   // Bundle.entry.request.url — relative request target
    'response.location', // Bundle.entry.response.location
    'item.definition', // Questionnaire(Response).item.definition carries ElementDefinition ids such as Patient.birthDate; Java accepts them
    'agent.policy', // AuditEvent.agent.policy is a plain uri; SAML/XACML policy ids are relative references Java accepts
    'content.path', // ArtifactAssessment.content.path holds element-path tokens such as 'status'; Java accepts them
    'component.path', // ArtifactAssessment.content.component recurses content, so nested paths end in component.path
]);

const RELATIVE_URI_EXACT_PATHS = new Set([
    'MessageDefinition.eventUri',
    'ValueSet.expansion.identifier',
    'ValueSet.expansion.parameter.valueUri',
    'ValueSet.expansion.contains.system',
    'TestScript.setup.action.operation.resource',
    'TestScript.setup.action.assert.resource',
    'TestScript.test.action.operation.resource',
    'TestScript.test.action.assert.resource',
    'TestScript.teardown.action.operation.resource',
    'TestReport.participant.uri',
    'TestReport.setup.action.operation.detail',
    'TestReport.setup.action.assert.detail',
    'TestReport.test.action.operation.detail',
    'TestReport.test.action.assert.detail',
    'TestReport.teardown.action.operation.detail',
    'TestReport.teardown.action.assert.detail',
]);

const RELATIVE_FHIR_TYPE_CODE_PATH_SUFFIXES = [
    '.definitionDataRequirement.type',
    '.dataRequirement.type',
    '.input.type',
    '.output.type',
    '.observationRequirement.type',
    '.observationResultRequirement.type',
    '.data.type',
];

const CANONICAL_REFERENCE_PATH_SUFFIXES = [
    '.activityDefinition',
    '.definitionCanonical',
    '.instantiatesCanonical',
    '.library',
    '.message',
    '.operationDefinition',
    '.profile',
    '.questionnaire',
    '.relatedArtifact.resource',
    '.targetProfile',
];

/**
 * Check if a path ends with a segment that allows relative URIs.
 * Uses the last two path segments (e.g. "request.url" from "Bundle.entry[0].request.url").
 */
function allowsRelativeUri(path: string): boolean {
    // Strip array indices for matching
    const stripped = path.replace(/\[\d+\]/g, '');
    if (RELATIVE_URI_EXACT_PATHS.has(stripped)) return true;
    if (isFhirTypeCodePath(stripped)) return true;
    if (isCodingSystemPath(stripped)) return true;
    if (isExtensionValueUriPath(stripped)) return true;

    const segments = stripped.split('.');
    if (segments.length >= 2) {
        const tail = segments.slice(-2).join('.');
        if (RELATIVE_URI_PATHS.has(tail)) return true;
    }
    return false;
}

function buildInvalidUriDetails(value: string, path: string): Record<string, unknown> {
    if (/\s/.test(value)) {
        const canonicalHint = isCanonicalReferencePath(path)
            ? ' Use a valid absolute canonical URL without spaces; encode literal spaces as %20 only when they are part of the canonical.'
            : '';
        return {
            value,
            fixHint: `Remove whitespace from the URI value.${canonicalHint}`,
        };
    }

    const canonicalReferenceDetails = buildCanonicalReferenceDetails(value, path);
    if (canonicalReferenceDetails) {
        return canonicalReferenceDetails;
    }

    const oidPattern = /^\d+(?:\.\d+)+$/;
    if (oidPattern.test(value)) {
        const suggestedUri = `urn:oid:${value}`;
        return {
            value,
            suggestedUri,
            fixHint: `Use '${suggestedUri}' for bare OID identifiers in FHIR URI fields.`,
        };
    }

    if (/^www\.[^\s]+$/.test(value)) {
        const suggestedUri = `https://${value}`;
        return {
            value,
            suggestedUri,
            fixHint: `Use an absolute URI with a scheme, for example '${suggestedUri}'.`,
        };
    }

    return {
        value,
        fixHint: `Use an absolute URI with a scheme such as 'https:', 'urn:', or 'urn:oid:'.`,
    };
}

function buildCanonicalReferenceDetails(value: string, path: string): Record<string, unknown> | null {
    if (!isCanonicalReferencePath(path)) return null;

    const relativeReferenceMatch = value.match(/^([A-Z][A-Za-z0-9]*)\/[^/\s]+(?:\/_history\/[^/\s]+)?$/);
    if (!relativeReferenceMatch) return null;

    const targetResourceType = relativeReferenceMatch[1];
    if (!KNOWN_FHIR_RESOURCE_TYPES.has(targetResourceType)) return null;

    return {
        value,
        expectedUriType: 'canonical URL',
        targetResourceType,
        fixHint: `Use the target ${targetResourceType}.url canonical, not the relative FHIR REST reference '${value}'.`,
    };
}

function isAbsoluteUri(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function isValidOidUrn(value: string): boolean {
    if (!/^urn:oid:/i.test(value)) return true;

    const oid = value.slice('urn:oid:'.length);
    const arcs = oid.split('.');
    if (arcs.length < 2 || arcs.some(arc => !/^(?:0|[1-9][0-9]*)$/.test(arc))) {
        return false;
    }

    const firstArc = Number(arcs[0]);
    const secondArc = Number(arcs[1]);
    if (!Number.isSafeInteger(firstArc) || firstArc < 0 || firstArc > 2) return false;
    if (!Number.isSafeInteger(secondArc)) return false;
    return firstArc === 2 || secondArc <= 39;
}

function isReferenceTypePath(path: string): boolean {
    const stripped = path.replace(/\[\d+\]/g, '');
    if (isFhirTypeCodePath(stripped)) return false;
    return stripped.endsWith('.type') && !stripped.endsWith('StructureDefinition.type');
}

function isFhirTypeCodePath(strippedPath: string): boolean {
    return RELATIVE_FHIR_TYPE_CODE_PATH_SUFFIXES.some(suffix => strippedPath.endsWith(suffix));
}

function isCodingSystemPath(strippedPath: string): boolean {
    if (!strippedPath.endsWith('.system')) return false;

    const segments = strippedPath.split('.');
    const parent = segments[segments.length - 2];
    return parent === 'coding' ||
        parent === 'code' ||
        parent.endsWith('Coding') ||
        // Meta.tag and Meta.security are arrays of Coding, but their element
        // names do not contain "coding". Coding.system is a FHIR `uri`, so a
        // relative URI is syntactically valid; terminology checks can still
        // report that the system cannot be resolved.
        parent === 'tag' ||
        parent === 'security';
}

/**
 * Extension.value[x] of type `uri` is a plain RFC 3986 URI reference, which
 * may be relative (e.g. PDex mTLS endpoint `standard` values). The Java
 * validator restricts its absolute-URI rule to canonical/system-like slots,
 * so flagging relative extension values would diverge from it. Canonical
 * extension values (`valueCanonical`) keep the absolute requirement.
 */
function isExtensionValueUriPath(strippedPath: string): boolean {
    const debracketed = strippedPath.replace(/\[url=(?:'[^']*'|"[^"]*")\]/g, '');
    return /(?:^|\.)(?:extension|modifierExtension)\.(?:valueUri|value\[x\])$/.test(debracketed);
}

function isCanonicalReferencePath(path: string): boolean {
    const stripped = path.replace(/\[\d+\]/g, '');
    return CANONICAL_REFERENCE_PATH_SUFFIXES.some(suffix => stripped.endsWith(suffix));
}

function validateReferenceTypeUri(value: string, path: string, resourceType: string): ValidationIssue | null {
    if (KNOWN_FHIR_RESOURCE_TYPES.has(value) || isAbsoluteUri(value)) {
        return null;
    }

    return createValidationIssue({
        code: 'reference-type-unknown',
        path,
        resourceType,
        aspectOverride: 'reference',
        severityOverride: 'warning',
        customMessage: `Unknown Reference.type value: '${value}'. Use a FHIR resource type such as 'Patient' or an absolute logical model URL.`,
        details: {
            value,
            referencedResourceType: value,
            fixHint: `Use a known FHIR resource type such as 'Patient', or an absolute logical model URL.`,
        },
    });
}

/**
 * Validates URI-shaped primitive values that Java reports as absolute-only.
 *
 * Some FHIR `uri` fields accept relative references while canonical/url-like
 * fields do not. Keep the absolute check path-sensitive to preserve Java parity
 * on fields such as Questionnaire.url while avoiding false positives on
 * relative TestReport detail links.
 */
export function validateUriFormat(value: string, path: string, resourceType: string, profileUrl?: string): ValidationIssue | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    // A URI with the urn:oid scheme is absolute, but it still has to contain
    // a syntactically valid object identifier. Apply this before path-specific
    // relative-URI allowances so invalid OIDs in Coding.system are not hidden.
    if (!isValidOidUrn(value)) {
        return createValidationIssue({
            code: 'structural-invalid-uri',
            path,
            resourceType,
            profile: profileUrl,
            severityOverride: 'error',
            customMessage: `OID URI '${value}' is not syntactically valid`,
            details: {
                value,
                expectedUriType: 'OID URN',
                fixHint: 'Use urn:oid followed by at least two numeric arcs without leading zeroes.',
            },
        });
    }

    // Some FHIR uri fields explicitly allow relative URIs
    if (allowsRelativeUri(path)) {
        return null;
    }

    // Fragment references (#id) are valid in canonical fields when
    // referring to contained resources. FHIR explicitly allows this.
    if (value.startsWith('#')) {
        return null;
    }

    // Reference.type is typed as `uri`, but FHIR uses relative resource type
    // names here (for example "Patient"). Unknown relative values are a
    // reference-type issue, not an invalid-absolute-URI structural issue.
    if (isReferenceTypePath(path)) {
        return validateReferenceTypeUri(value, path, resourceType);
    }

    // Bundle.entry.fullUrl and Bundle.link.url are validated by
    // BundleValidator with more specific messages. Skip here.
    if (path.includes('.fullUrl') || path.endsWith('.fullUrl') ||
        path.includes('Bundle.link')) {
        return null;
    }

    if (/\s/.test(value) || !isAbsoluteUri(value)) {
        return createValidationIssue({
            code: 'structural-invalid-uri',
            path,
            resourceType,
            profile: profileUrl,
            severityOverride: 'error',
            customMessage: /\s/.test(value)
                ? `URI '${value}' contains whitespace and is not a valid absolute URI`
                : `URI '${value}' is not a valid absolute URI`,
            details: buildInvalidUriDetails(value, path)
        });
    }

    return null;
}
