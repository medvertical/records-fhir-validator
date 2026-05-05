/**
 * Code Aliases
 * 
 * Backwards-compatible aliases mapping legacy codes to new unified codes.
 */

// Use string type to avoid circular dep with ./index which re-exports this module
export const CodeAliases: Record<string, string> = {
    // Terminology aliases
    'binding-strength-violation-required': 'terminology-binding-required',
    'binding-strength-violation-extensible': 'terminology-binding-extensible',
    'binding-strength-violation-preferred': 'terminology-binding-preferred',
    'binding-strength-violation-example': 'terminology-binding-example',
    'binding-strength-violation': 'terminology-binding-required',
    'binding-required-missing': 'terminology-binding-missing',
    'binding-violation': 'terminology-binding-required',
    'valueset-validation-error': 'terminology-valueset-error',

    // Version ID aliases
    'invalid-versionId-type': 'metadata-version-id-invalid-type',
    'empty-versionId': 'metadata-version-id-empty',
    'invalid-versionId-format': 'metadata-version-id-invalid-format',
    'versionId-timestamp-pattern': 'metadata-version-id-timestamp-pattern',
    'versionId-non-positive': 'metadata-version-id-non-positive',
    'versionId-only-special-chars': 'metadata-version-id-special-chars-only',
    'versionId-etag-format': 'metadata-version-id-etag-format',
    'versionId-same-as-id': 'metadata-version-id-same-as-id',
    'versionId-very-high': 'metadata-version-id-very-high',
    'versionId-validation-error': 'metadata-version-id-validation-error',

    // Last Updated aliases
    'invalid-lastUpdated-type': 'metadata-last-updated-invalid-type',
    'lastUpdated-missing-timezone': 'metadata-last-updated-missing-timezone',
    'invalid-lastUpdated-format': 'metadata-last-updated-invalid-format',
    'lastUpdated-non-utc-timezone': 'metadata-last-updated-non-utc',
    'lastUpdated-missing-seconds': 'metadata-last-updated-missing-seconds',
    'future-lastUpdated': 'metadata-last-updated-future',
    'old-lastUpdated': 'metadata-last-updated-old',
    'lastUpdated-unix-epoch': 'metadata-last-updated-unix-epoch',
    'lastUpdated-at-midnight': 'metadata-last-updated-at-midnight',
    'lastUpdated-validation-error': 'metadata-last-updated-validation-error',
    'chronological-order-violation': 'metadata-chronological-order-violation',
    'identical-timestamps': 'metadata-identical-timestamps',

    // Tag aliases
    'invalid-tag-array': 'metadata-tag-invalid-array',
    'invalid-tag-object': 'metadata-tag-invalid-object',
    'tag-missing-system-code': 'metadata-tag-missing-system-code',
    'tag-missing-code': 'metadata-tag-missing-code',
    'tag-invalid-system-type': 'metadata-tag-invalid-system-type',
    'tag-invalid-system-uri': 'metadata-tag-invalid-system-uri',
    'tag-invalid-code-type': 'metadata-tag-invalid-code-type',
    'tag-invalid-display-type': 'metadata-tag-invalid-display-type',
    'tag-code-without-system': 'metadata-tag-code-without-system',
    'tag-duplicate': 'metadata-tag-duplicate',
    'tag-short-display': 'metadata-tag-short-display',
    'tag-code-as-display': 'metadata-tag-code-as-display',
    'tag-long-display': 'metadata-tag-long-display',

    // Security aliases
    'invalid-security-array': 'metadata-security-invalid-array',
    'invalid-security-object': 'metadata-security-invalid-object',
    'security-missing-system': 'metadata-security-missing-system',
    'security-missing-code': 'metadata-security-missing-code',
    'security-invalid-system': 'metadata-security-invalid-system',
    'security-invalid-code-type': 'metadata-security-invalid-code-type',
    'security-invalid-display-type': 'metadata-security-invalid-display-type',
    'security-duplicate': 'metadata-security-duplicate',
    'security-missing-display': 'metadata-security-missing-display',
    'security-unknown-code': 'metadata-security-unknown-code',
    'unknown-security-system': 'metadata-security-unknown-system',

    // Source aliases
    'invalid-source-type': 'metadata-source-invalid-type',
    'empty-source': 'metadata-source-empty',
    'source-too-long': 'metadata-source-too-long',
    'invalid-source-format': 'metadata-source-invalid-format',
    'source-localhost': 'metadata-source-localhost',
    'source-looks-like-reference': 'metadata-source-looks-like-reference',
    'source-relative-uri': 'metadata-source-relative-uri',
    'source-validation-error': 'metadata-source-validation-error',

    // Profile metadata aliases
    'invalid-profile-array': 'metadata-profile-invalid-array',
    'invalid-profile-type': 'metadata-profile-invalid-type',
    'invalid-profile-url': 'metadata-profile-invalid-url',
    'profile-resource-type-mismatch': 'metadata-profile-resource-type-mismatch',
    'profile-duplicate': 'metadata-profile-duplicate',
    'profile-not-accessible': 'metadata-profile-not-accessible',
    'profile-wrong-resource-type': 'metadata-profile-wrong-resource-type',

    // Metadata general aliases
    'missing-meta': 'metadata-missing-meta',
    'invalid-meta-type': 'metadata-invalid-meta-type',

    // Reference aliases
    'empty-reference': 'reference-empty',
    'invalid-contained-reference': 'reference-invalid-contained',
    'invalid-reference-url': 'reference-invalid-url',
    'invalid-reference-format': 'reference-invalid-format',
    'reference-type-mismatch': 'reference-type-mismatch',
    'unknown-reference-type': 'reference-type-unknown',
    'contained-reference-not-found': 'reference-contained-not-found',
    'contained-reference-type-mismatch': 'reference-contained-type-mismatch',
    'contained-reference-type-unknown': 'reference-contained-type-unknown',
    'reference-not-found': 'reference-not-found',
    'reference-validation-error': 'reference-validation-error',

    // Bundle aliases
    'unresolved-bundle-reference': 'reference-bundle-unresolved',
    'duplicate-bundle-fullurl': 'reference-bundle-duplicate-fullurl',
    'bundle-fullurl-mismatch': 'reference-bundle-fullurl-mismatch',
    'bundle-missing-type': 'reference-bundle-missing-type',
    'bundle-missing-entries': 'reference-bundle-missing-entries',
    'bundle-invalid-entries': 'reference-bundle-invalid-entries',
    'bundle-entry-missing-request': 'reference-bundle-entry-missing-request',
    'bundle-request-missing-method': 'reference-bundle-request-missing-method',
    'bundle-request-missing-url': 'reference-bundle-request-missing-url',

    // Structural aliases
    'required-element-missing': 'structural-required-element-missing',
    'resource-type-mismatch': 'structural-resource-type-mismatch',
    'missing-resourcetype': 'structural-missing-resource-type',
    'invalid-json': 'structural-invalid-json',
    'cardinality-violation': 'structural-cardinality-violation',
    'type-mismatch': 'structural-type-mismatch',
    'hapi-validation-error': 'structural-hapi-error',

    // Profile aliases
    'constraint-violation': 'profile-constraint-violation',
    'slice-min-cardinality': 'profile-slice-min-cardinality',
    'slice-max-cardinality': 'profile-slice-max-cardinality',
    'slice-closed-unmatched': 'profile-slice-closed-unmatched',
    'slice-ordering-violation': 'profile-slice-ordering-violation',
    'slice-validation-error': 'profile-slice-validation-error',
    'extension-invalid': 'profile-extension-invalid',
    'slicing-violation': 'profile-slicing-violation',
    'mustsupport-missing': 'profile-mustsupport-missing',
    'profile-validation-error': 'profile-validation-error',

    // Business rule aliases
    'rule-violation': 'business-rule-violation',
    'value-out-of-range': 'business-value-out-of-range',
    'negative-value': 'business-negative-value',
    'invalid-effective-date': 'business-invalid-effective-date',
    'future-effective-date': 'business-future-effective-date',
    'final-status-no-value': 'business-final-status-no-value',
    'invalid-onset-date': 'business-invalid-onset-date',
    'future-onset-date': 'business-future-onset-date',
    'invalid-birth-date': 'business-invalid-birth-date',
    'future-birth-date': 'business-future-birth-date',
    'unreasonable-age': 'business-unreasonable-age',
    'invalid-period-start': 'business-invalid-period-start',
    'invalid-period-end': 'business-invalid-period-end',
    'end-before-start': 'business-end-before-start',
    'finished-status-no-end': 'business-finished-status-no-end',
};
