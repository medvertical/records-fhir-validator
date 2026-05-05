/**
 * Structural Validation Codes
 * 
 * Codes for structural validation (JSON, cardinality, types).
 */

import type { ValidationCodeMetadata } from './validation-code-types';

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
    'structural-validation-error': {
        aspect: 'structural',
        severity: 'warning',
        description: 'Structural validation failed',
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
