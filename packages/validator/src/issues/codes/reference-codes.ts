/**
 * Reference Validation Codes
 * 
 * Codes for reference validation including bundle references.
 */

import type { ValidationCodeMetadata } from './validation-code-types';

export const ReferenceCodes = {
    // -------------------------------------------------------------------------
    // Reference Aspect
    // -------------------------------------------------------------------------
    'reference-empty': {
        aspect: 'reference',
        severity: 'error',
        description: 'Reference is empty',
    },
    'reference-invalid-contained': {
        aspect: 'reference',
        severity: 'error',
        description: 'Invalid contained reference format',
    },
    'reference-invalid-url': {
        aspect: 'reference',
        severity: 'error',
        description: 'Invalid reference URL',
    },
    'reference-invalid-format': {
        aspect: 'reference',
        severity: 'error',
        description: 'Invalid reference format',
    },
    'reference-type-mismatch': {
        aspect: 'reference',
        severity: 'error',
        description: 'Reference type does not match allowed types',
    },
    'reference-type-unknown': {
        aspect: 'reference',
        severity: 'warning',
        description: 'Unknown reference type',
    },
    'reference-contained-not-found': {
        aspect: 'reference',
        severity: 'error',
        description: 'Contained reference not found',
    },
    'reference-contained-type-mismatch': {
        aspect: 'reference',
        severity: 'error',
        description: 'Contained reference type mismatch',
    },
    'reference-contained-type-unknown': {
        aspect: 'reference',
        severity: 'warning',
        description: 'Unknown contained reference type',
    },
    'reference-not-found': {
        aspect: 'reference',
        severity: 'error',
        description: 'Referenced resource not found',
    },
    'reference-validation-error': {
        aspect: 'reference',
        severity: 'warning',
        description: 'Reference validation failed',
    },

    // -------------------------------------------------------------------------
    // Bundle References
    // -------------------------------------------------------------------------
    'reference-bundle-unresolved': {
        aspect: 'reference',
        severity: 'error',
        description: 'Unresolved bundle reference',
    },
    'reference-bundle-duplicate-fullurl': {
        aspect: 'reference',
        severity: 'error',
        description: 'Duplicate fullUrl in bundle',
    },
    'reference-bundle-fullurl-mismatch': {
        aspect: 'reference',
        severity: 'warning',
        description: 'Bundle fullUrl does not match resource',
    },
    'reference-bundle-missing-type': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle is missing type',
    },
    'reference-bundle-missing-entries': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle is missing entries',
    },
    'reference-bundle-invalid-entries': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle entries are invalid',
    },
    'reference-bundle-entry-missing-request': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle entry missing request',
    },
    'reference-bundle-request-missing-method': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle request missing method',
    },
    'reference-bundle-request-missing-url': {
        aspect: 'reference',
        severity: 'error',
        description: 'Bundle request missing url',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type ReferenceCode = keyof typeof ReferenceCodes;
