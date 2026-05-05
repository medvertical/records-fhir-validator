/**
 * Metadata Validation Codes
 * 
 * Codes for meta element validation (versionId, lastUpdated, tags, security, source, profiles).
 */

import type { ValidationCodeMetadata } from './validation-code-types';

export const MetadataCodes = {
    // -------------------------------------------------------------------------
    // Version ID
    // -------------------------------------------------------------------------
    'metadata-version-id-invalid-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'versionId must be a string',
    },
    'metadata-version-id-empty': {
        aspect: 'metadata',
        severity: 'error',
        description: 'versionId cannot be empty',
    },
    'metadata-version-id-invalid-format': {
        aspect: 'metadata',
        severity: 'error',
        description: 'versionId does not match FHIR id pattern',
    },
    'metadata-version-id-timestamp-pattern': {
        aspect: 'metadata',
        severity: 'info',
        description: 'versionId appears to be a timestamp',
    },
    'metadata-version-id-non-positive': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Numeric versionId should be positive',
    },
    'metadata-version-id-special-chars-only': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'versionId consists only of special characters',
    },
    'metadata-version-id-etag-format': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'versionId appears to be in ETag format',
    },
    'metadata-version-id-same-as-id': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'versionId should not match resource.id',
    },
    'metadata-version-id-very-high': {
        aspect: 'metadata',
        severity: 'info',
        description: 'versionId is unusually high',
    },
    'metadata-version-id-validation-error': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'versionId validation failed',
    },

    // -------------------------------------------------------------------------
    // Last Updated
    // -------------------------------------------------------------------------
    'metadata-last-updated-invalid-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'lastUpdated must be a string',
    },
    'metadata-last-updated-missing-timezone': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'lastUpdated is missing timezone',
    },
    'metadata-last-updated-invalid-format': {
        aspect: 'metadata',
        severity: 'error',
        description: 'lastUpdated does not match instant format',
    },
    'metadata-last-updated-non-utc': {
        aspect: 'metadata',
        severity: 'info',
        description: 'lastUpdated uses non-UTC timezone',
    },
    'metadata-last-updated-missing-seconds': {
        aspect: 'metadata',
        severity: 'info',
        description: 'lastUpdated is missing seconds precision',
    },
    'metadata-last-updated-future': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'lastUpdated is in the future',
    },
    'metadata-last-updated-old': {
        aspect: 'metadata',
        severity: 'info',
        description: 'lastUpdated is very old',
    },
    'metadata-last-updated-unix-epoch': {
        aspect: 'metadata',
        severity: 'info',
        description: 'lastUpdated is near Unix epoch',
    },
    'metadata-last-updated-at-midnight': {
        aspect: 'metadata',
        severity: 'info',
        description: 'lastUpdated is exactly at midnight',
    },
    'metadata-last-updated-validation-error': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'lastUpdated validation failed',
    },
    'metadata-chronological-order-violation': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Timestamps are not in chronological order',
    },
    'metadata-identical-timestamps': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Multiple timestamps have identical values',
    },

    // -------------------------------------------------------------------------
    // Tags
    // -------------------------------------------------------------------------
    'metadata-tag-invalid-array': {
        aspect: 'metadata',
        severity: 'error',
        description: 'meta.tag must be an array',
    },
    'metadata-tag-invalid-object': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Tag must be an object',
    },
    'metadata-tag-missing-system-code': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Tag should have system and/or code',
    },
    'metadata-tag-missing-code': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Tag must have a code',
    },
    'metadata-tag-invalid-system-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Tag system must be a string',
    },
    'metadata-tag-invalid-system-uri': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Tag system is not a valid URI',
    },
    'metadata-tag-invalid-code-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Tag code must be a string',
    },
    'metadata-tag-invalid-display-type': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Tag display must be a string',
    },
    'metadata-tag-code-without-system': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Tag has code without system',
    },
    'metadata-tag-duplicate': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Duplicate tag detected',
    },
    'metadata-tag-short-display': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Tag display is very short',
    },
    'metadata-tag-code-as-display': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Tag display appears to be same as code',
    },
    'metadata-tag-long-display': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Tag display is very long',
    },

    // -------------------------------------------------------------------------
    // Security
    // -------------------------------------------------------------------------
    'metadata-security-invalid-array': {
        aspect: 'metadata',
        severity: 'error',
        description: 'meta.security must be an array',
    },
    'metadata-security-invalid-object': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Security label must be an object',
    },
    'metadata-security-missing-system': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Security label missing system',
    },
    'metadata-security-missing-code': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Security label missing code',
    },
    'metadata-security-invalid-system': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Security system is not a valid URI',
    },
    'metadata-security-invalid-code-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Security code must be a string',
    },
    'metadata-security-invalid-display-type': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Security display must be a string',
    },
    'metadata-security-duplicate': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Duplicate security label detected',
    },
    'metadata-security-missing-display': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Security label missing display',
    },
    'metadata-security-unknown-code': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Unknown security code',
    },
    'metadata-security-unknown-system': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Unknown security system',
    },

    // -------------------------------------------------------------------------
    // Source
    // -------------------------------------------------------------------------
    'metadata-source-invalid-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'source must be a string',
    },
    'metadata-source-empty': {
        aspect: 'metadata',
        severity: 'error',
        description: 'source cannot be empty',
    },
    'metadata-source-too-long': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'source exceeds reasonable length',
    },
    'metadata-source-invalid-format': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'source is not a valid URI',
    },
    'metadata-source-localhost': {
        aspect: 'metadata',
        severity: 'info',
        description: 'source references localhost',
    },
    'metadata-source-looks-like-reference': {
        aspect: 'metadata',
        severity: 'info',
        description: 'source looks like a FHIR reference',
    },
    'metadata-source-relative-uri': {
        aspect: 'metadata',
        severity: 'info',
        description: 'source is a relative URI',
    },
    'metadata-source-validation-error': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'source validation failed',
    },

    // -------------------------------------------------------------------------
    // Profiles
    // -------------------------------------------------------------------------
    'metadata-profile-invalid-array': {
        aspect: 'metadata',
        severity: 'error',
        description: 'meta.profile must be an array',
    },
    'metadata-profile-invalid-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Profile entry must be a string',
    },
    'metadata-profile-invalid-url': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Profile URL is not valid',
    },
    'metadata-profile-resource-type-mismatch': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Profile does not match resource type',
    },
    'metadata-profile-duplicate': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Duplicate profile declared',
    },
    'metadata-profile-not-accessible': {
        aspect: 'metadata',
        severity: 'warning',
        description: 'Profile is not accessible',
    },
    'metadata-profile-wrong-resource-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'Profile is for wrong resource type',
    },

    // -------------------------------------------------------------------------
    // General
    // -------------------------------------------------------------------------
    'metadata-missing-meta': {
        aspect: 'metadata',
        severity: 'info',
        description: 'Resource is missing meta element',
    },
    'metadata-invalid-meta-type': {
        aspect: 'metadata',
        severity: 'error',
        description: 'meta must be an object',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type MetadataCode = keyof typeof MetadataCodes;
