/**
 * Structural Validation Codes
 * 
 * Codes for structural validation (JSON, cardinality, types).
 */

import type { ValidationCodeMetadata } from './validation-code-types.js';

export const StructuralCodes = {
    'structural-required-element-missing': {
        aspect: 'structural',
        severity: 'error',
        description: 'Required element is missing',
    },
    'structural-resource-type-mismatch': {
        aspect: 'structural',
        severity: 'error',
        description: 'Resource type does not match',
    },
    'structural-missing-resource-type': {
        aspect: 'structural',
        severity: 'error',
        description: 'Resource is missing resourceType',
    },
    'structural-invalid-json': {
        aspect: 'structural',
        severity: 'error',
        description: 'Invalid JSON',
    },
    'structural-invalid-format': {
        aspect: 'structural',
        severity: 'error',
        description: 'Primitive value format is invalid',
    },
    'structural-invalid-base64-format': {
        aspect: 'structural',
        severity: 'error',
        description: 'base64Binary value format is invalid',
    },
    'structural-cardinality-violation': {
        aspect: 'structural',
        severity: 'error',
        description: 'Element cardinality violated',
    },
    'structural-cardinality-min': {
        aspect: 'structural',
        severity: 'error',
        description: 'Element count below minimum',
    },
    'structural-cardinality-max': {
        aspect: 'structural',
        severity: 'error',
        description: 'Element count exceeds maximum',
    },
    'structural-type-mismatch': {
        aspect: 'structural',
        severity: 'error',
        description: 'Element type does not match',
    },
    'structural-primitive-type-mismatch': {
        aspect: 'structural',
        severity: 'error',
        description: 'Primitive element type does not match',
    },
    'structural-attachment-size-mismatch': {
        aspect: 'structural',
        severity: 'error',
        description: 'Attachment.size does not match the decoded Attachment.data byte length',
    },
    'structural-attachment-hash-mismatch': {
        aspect: 'structural',
        severity: 'error',
        description: 'Attachment.hash does not match the SHA-1 digest of Attachment.data',
    },
    'attachment-att1-violation': {
        aspect: 'structural',
        severity: 'error',
        description: 'Attachment has data but no contentType (invariant att-1)',
    },
    'attachment-no-content': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Attachment has neither data nor url, and no contentType or language',
    },
    'string-whitespace-padding': {
        aspect: 'structural',
        severity: 'warning',
        description: 'String value starts or ends with whitespace',
    },
    'string-whitespace-only': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Primitive value consists only of whitespace',
    },
    'decimal-value-out-of-range': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Decimal value is outside the range of commonly supported decimals',
    },
    'language-code-invalid': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Resource.language is not a valid BCP-47 tag of IANA-registered subtags',
    },
    'string-illegal-xml-chars': {
        aspect: 'structural',
        severity: 'warning',
        description: 'String value contains control characters that are illegal in the XML version of FHIR',
    },
    'structural-validation-error': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Structural validation failed',
    },
    'structural-xml-text-not-allowed': {
        aspect: 'structural',
        severity: 'error',
        description: 'Text present where the element allows none',
    },
    'structural-xml-attribute-undefined': {
        aspect: 'structural',
        severity: 'error',
        description: 'Undefined attribute on element',
    },
    'structural-xml-attribute-empty': {
        aspect: 'structural',
        severity: 'error',
        description: 'Attribute written with an empty value',
    },
    'structural-hapi-error': {
        aspect: 'structural',
        severity: 'error',
        description: 'HAPI structural validation error',
    },
    'structural-unknown-element': {
        aspect: 'structural',
        severity: 'error',
        description: 'Unknown element in resource',
    },
    'structural-contained-not-referenced': {
        aspect: 'structural',
        severity: 'error',
        description: 'Contained resource is not referenced from the containing resource and does not refer to it (dom-3)',
    },
    'structural-contained-id-missing': {
        aspect: 'structural',
        severity: 'error',
        description: 'Contained resource is missing its required id',
    },
    'bundle-link-relation-duplicate': {
        aspect: 'structural',
        severity: 'error',
        description: 'Bundle.link relation type occurs more than once',
    },
    'bundle-link-relation-prohibited': {
        aspect: 'structural',
        severity: 'error',
        description: 'Bundle.link uses a paging relation in a bundle type that is not paged',
    },
    'questionnaire-reference-not-resolved': {
        aspect: 'structural',
        severity: 'warning',
        description: 'QuestionnaireResponse.questionnaire could not be resolved',
    },

    // Narrative (text.div) XHTML validation
    'narrative-malformed-xhtml': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative text.div is not well-formed XHTML (includes DOCTYPE/ENTITY XXE protection)',
    },
    'narrative-invalid-root': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative text.div must be <div xmlns="http://www.w3.org/1999/xhtml">',
    },
    'narrative-missing-div': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative text is missing required div element',
    },
    'narrative-invalid-status': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative.status is not a valid code',
    },
    'narrative-forbidden-content': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative contains forbidden content (scripts, forms, etc.)',
    },
    'narrative-invalid-element': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative contains a disallowed XHTML element',
    },
    'narrative-invalid-attribute': {
        aspect: 'structural',
        severity: 'error',
        description: 'Narrative contains a disallowed XHTML attribute',
    },

    // Generic / Fallback
    'validation-error': {
        aspect: 'structural',
        severity: 'warning',
        description: 'General validation error',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type StructuralCode = keyof typeof StructuralCodes;
