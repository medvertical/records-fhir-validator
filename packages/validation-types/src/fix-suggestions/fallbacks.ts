import type { FixSuggestion } from './types';

// ============================================================================
// Aspect-based Fallbacks (when no specific code match exists)
// ============================================================================

export const ASPECT_FALLBACKS: Record<string, FixSuggestion> = {
    structural: {
        why: 'Structural errors indicate the resource format does not match FHIR specifications.',
        fix: 'Check element cardinality, required fields, and data types.',
    },
    terminology: {
        why: 'Terminology errors indicate codes are not from the required value sets.',
        fix: 'Verify the code exists in the required ValueSet or use an allowed alternative.',
    },
    reference: {
        why: 'Reference errors indicate linked resources cannot be resolved.',
        fix: 'Ensure referenced resources exist and are accessible.',
    },
    metadata: {
        why: 'Metadata errors relate to resource meta fields.',
        fix: 'Review meta fields like lastUpdated, versionId, and profile declarations.',
    },
    profile: {
        why: 'Profile errors indicate the resource does not conform to declared constraints.',
        fix: 'Check that the resource meets all profile requirements.',
    },
    invariant: {
        why: 'Invariant errors indicate standard FHIR or profile constraint violations.',
        fix: 'Review the invariant expression and adjust the resource to satisfy the constraint.',
    },
    custom_rule: {
        why: 'Custom rule errors indicate user-defined domain constraint violations.',
        fix: 'Review the custom rule requirements for this element.',
    },
};

// ============================================================================
// Code Aliases
// ============================================================================

/**
 * Alias table to reconcile emitted validation codes with catalog keys that
 * use a different naming convention. Historically the catalog grew with
 * aspect prefixes (`structural-`, `reference-`, `metadata-`, `business-`)
 * while validators started emitting shorter, prefix-free codes.
 *
 * Rather than rewriting either side, `getFixSuggestion` consults this table
 * as a second-tier lookup. Adding an alias here is the preferred way to
 * close coverage gaps uncovered by `scripts/measure-fix-suggestion-coverage.ts`.
 */
export const FIX_SUGGESTION_ALIASES: Record<string, string> = {
    // --- Structural ---
    'missing-resourcetype': 'structural-missing-resource-type',
    'resource-type-mismatch': 'structural-resource-type-mismatch',
    'invalid-json': 'structural-invalid-json',
    'missing-id': 'structural-required-element-missing',
    'required-element-missing': 'structural-required-element-missing',
    'schema-validation-error': 'structural-validation-error',
    'schema-validator-unavailable': 'structural-validation-error',
    'schema-version-fallback': 'structural-validation-error',
    'validator-error': 'validation-error',

    // --- Reference ---
    'reference-not-found': 'reference-not-found',
    'empty-reference': 'reference-empty',
    'invalid-reference-format': 'reference-invalid-format',
    'invalid-reference-url': 'reference-invalid-url',
    'invalid-contained-reference': 'reference-invalid-contained',
    'unknown-reference-type': 'reference-type-mismatch',
    'unresolved-bundle-reference': 'reference-bundle-unresolved',
    'duplicate-bundle-fullurl': 'reference-bundle-duplicate-fullurl',
    'bundle-fullurl-mismatch': 'reference-bundle-fullurl-mismatch',
    'bundle-invalid-entries': 'reference-bundle-invalid-entries',
    'bundle-missing-entries': 'reference-bundle-missing-entries',
    'bundle-missing-type': 'reference-bundle-missing-type',
    'bundle-entry-missing-request': 'reference-bundle-entry-missing-request',
    'bundle-request-missing-method': 'reference-bundle-request-missing-method',
    'bundle-request-missing-url': 'reference-bundle-request-missing-url',
    'contained-reference-not-found': 'reference-contained-not-found',
    'contained-reference-type-mismatch': 'reference-contained-type-mismatch',
    'contained-unresolved-reference': 'reference-contained-not-found',

    // --- Metadata ---
    'missing-meta': 'metadata-missing-meta',
    'invalid-meta-type': 'metadata-invalid-meta-type',
    'metadata-tag-invalid-code-type': 'metadata-tag-missing-code',

    // --- Profile ---
    'profile-not-found': 'profile-not-found',
    'profile-mismatch': 'profile-not-declared',
    'profile-extension-invalid': 'profile-extension-invalid',
    'profile-slicing-violation': 'profile-slicing-violation',
    'profile-slice-validation-error': 'profile-slicing-violation',
    'profile-slice-fixed-value-mismatch': 'profile-slicing-violation',
    'profile-slice-fixed-value-missing': 'profile-slicing-violation',
    'profile-slice-ordering-violation': 'profile-slicing-violation',
    'profile-slice-pattern-mismatch': 'profile-slicing-violation',
    'profile-fixed-value-mismatch': 'profile-slicing-violation',
    'profile-pattern-mismatch': 'profile-slicing-violation',
    'profile-extension-missing-value': 'profile-extension-invalid',
    'profile-extension-validation-error': 'profile-extension-invalid',

    // --- Business rule (invariant/custom rule) ---
    'future-birth-date': 'business-future-birth-date',
    'invalid-birth-date': 'business-invalid-birth-date',
    'future-effective-date': 'business-future-effective-date',
    'invalid-effective-date': 'business-invalid-effective-date',
    'future-onset-date': 'business-future-onset-date',
    'invalid-onset-date': 'business-invalid-onset-date',
    'unreasonable-age': 'business-unreasonable-age',
    'end-before-start': 'business-end-before-start',
    'negative-value': 'business-negative-value',
    'value-out-of-range': 'business-value-out-of-range',
    'final-status-no-value': 'business-final-status-no-value',
    'custom-rule-violation': 'business-rule-violation',
    'custom-rule-evaluation-error': 'business-rule-violation',

    // --- Terminology ---
    'terminology-code-invalid': 'terminology-binding-required',
    'terminology-validation-error': 'terminology-valueset-error',
    'terminology-servers-unavailable': 'terminology-valueset-error',
    'invalid-code': 'terminology-binding-required',
    'not-found': 'terminology-valueset-error',
    'binding-required-missing': 'terminology-binding-missing',

    // --- HAPI errors ---
    'hapi-validation-error': 'structural-hapi-error',
    'hapi-profile-validation-error': 'structural-hapi-error',
    'hapi-terminology-error': 'terminology-valueset-error',
};

