import type { FixSuggestion } from './types.js';

export const CATALOG_METADATA: Record<string, FixSuggestion> = {
    'metadata-profile-wrong-resource-type': {
        why: 'The declared profile is for a different resource type.',
        fix: 'Use a profile that matches the resource type, or remove the meta.profile entry.',
    },
    'metadata-source-invalid-format': {
        why: 'meta.source should be a valid URI identifying the data origin.',
        fix: 'Use a proper URI format (e.g., urn:uuid:... or https://...).',
    },
    'metadata-version-id-invalid-type': {
        why: 'versionId must be a string per FHIR specification.',
        fix: 'Convert versionId to string format.',
    },
    'metadata-version-id-empty': {
        why: 'versionId tracks resource versions for conflict detection (optimistic locking).',
        fix: 'Let the FHIR server assign versionId on CREATE/UPDATE, or use a positive integer.',
        example: 'meta: { versionId: "1" }',
    },
    'metadata-version-id-invalid-format': {
        why: 'versionId must match FHIR id pattern (alphanumeric, hyphens, up to 64 chars).',
        fix: 'Use a simple numeric or alphanumeric version identifier.',
    },
    'metadata-version-id-timestamp-pattern': {
        why: 'versionId looks like a timestamp which may cause confusion.',
        fix: 'Consider using sequential integers for clarity. This is informational only.',
    },
    'metadata-version-id-non-positive': {
        why: 'Numeric versionIds should typically start at 1 and increment.',
        fix: 'Use positive integers starting from 1.',
    },
    'metadata-version-id-special-chars-only': {
        why: 'versionId with only special characters may be hard to read/use.',
        fix: 'Consider a more readable format like sequential numbers.',
    },
    'metadata-version-id-etag-format': {
        why: 'ETag format (W/"...") is for HTTP headers, not versionId directly.',
        fix: 'Use just the version number without ETag wrapper.',
    },
    'metadata-version-id-same-as-id': {
        why: 'versionId and resource id serve different purposes, but matching values are not a FHIR conformance error.',
        fix: 'Informational only. Keep it if your server intentionally starts versioning at the logical id value.',
    },
    'metadata-version-id-very-high': {
        why: 'Unusually high versionId may indicate timestamp-based versioning.',
        fix: 'This is informational. Verify versioning strategy is intentional.',
    },
    'metadata-last-updated-invalid-type': {
        why: 'lastUpdated must be a string in instant format.',
        fix: 'Convert to string format: YYYY-MM-DDTHH:MM:SS.sss+ZZ:ZZ',
    },
    'metadata-last-updated-missing-timezone': {
        why: 'FHIR instant type requires timezone for unambiguous timestamp interpretation.',
        fix: 'Add timezone suffix. Use Z for UTC or +/-HH:MM for local time.',
        example: '2025-01-10T18:00:00Z or 2025-01-10T19:00:00+01:00',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#instant',
        patch: { action: 'replace', path: 'meta.lastUpdated', value: '"{{actualValue}}Z"' },
    },
    'metadata-last-updated-invalid-format': {
        why: 'lastUpdated must be a valid FHIR instant (ISO 8601 with timezone).',
        fix: 'Use format: YYYY-MM-DDTHH:MM:SS.sssZ or YYYY-MM-DDTHH:MM:SS+ZZ:ZZ',
    },
    'metadata-last-updated-non-utc': {
        why: 'Non-UTC timezone is valid but may complicate timestamp comparison.',
        fix: 'This is informational. Consider using UTC (Z) for consistency.',
    },
    'metadata-last-updated-missing-seconds': {
        why: 'Seconds precision provides more accurate update timing.',
        fix: 'Include seconds in timestamp. This is informational.',
    },
    'metadata-last-updated-future': {
        why: 'lastUpdated should reflect when the resource was last modified on the server.',
        fix: 'Verify the timestamp source. Let the server manage lastUpdated if possible.',
    },
    'metadata-last-updated-old': {
        why: 'Very old lastUpdated may indicate stale or migrated data.',
        fix: 'Verify this is intentional. Consider updating if data was recently modified.',
    },
    'metadata-last-updated-unix-epoch': {
        why: 'Timestamp near Unix epoch (1970-01-01) is likely a default/error.',
        fix: 'Set correct lastUpdated or let server manage it.',
    },
    'metadata-last-updated-at-midnight': {
        why: 'Exact midnight may indicate date-only data converted to instant.',
        fix: 'Include actual time if available for better precision.',
    },
    'metadata-tag-missing-code': {
        why: 'Tags are more useful for filtering and categorization when they include a code.',
        fix: 'Add a code value to the tag: { system: "...", code: "my-tag" }',
    },
    'metadata-tag-invalid-system-uri': {
        why: 'Tag system should be a valid URI for consistency.',
        fix: 'Use a proper URI format (e.g., http://example.org/tags).',
    },
    'metadata-tag-invalid-array': {
        why: 'meta.tag must be an array of Coding elements.',
        fix: 'Wrap tag in array: meta: { tag: [{ system: "...", code: "..." }] }',
    },
    'metadata-tag-invalid-object': {
        why: 'Each tag must be a valid Coding object.',
        fix: 'Use object format: { system: "...", code: "...", display: "..." }',
    },
    'metadata-tag-missing-system-code': {
        why: 'Tags should have both system and code for unambiguous identification.',
        fix: 'Add system URI and code to the tag.',
    },
    'metadata-tag-invalid-system-type': {
        why: 'Tag system must be a string URI.',
        fix: 'Convert system to string format.',
    },
    'metadata-tag-code-without-system': {
        why: 'Tag code without system may be ambiguous.',
        fix: 'Add a system URI to identify the code\'s namespace.',
    },
    'metadata-source-empty': {
        why: 'Empty source provides no provenance information.',
        fix: 'Add a meaningful source URI or remove the element.',
    },
    'metadata-source-too-long': {
        why: 'Excessively long source may indicate embedded data.',
        fix: 'Use a concise URI identifier, not embedded content.',
    },
    'metadata-source-localhost': {
        why: 'Localhost source won\'t resolve in other environments.',
        fix: 'Use a proper, resolvable URI for production data.',
    },
    'metadata-source-looks-like-reference': {
        why: 'Source should be a URI, not a FHIR reference format.',
        fix: 'Use URI format (e.g., urn:uuid:... or https://...).',
    },
    'metadata-source-relative-uri': {
        why: 'Relative URIs may be ambiguous without a base.',
        fix: 'Use absolute URI for unambiguous source identification.',
    },
    'metadata-source-invalid-type': {
        why: 'Source must be a string per FHIR specification.',
        fix: 'Convert source to string format.',
    },
    'metadata-source-validation-error': {
        why: 'Source validation failed for an unspecified reason.',
        fix: 'Check source format and ensure it\'s a valid URI.',
    },
    'metadata-tag-duplicate': {
        why: 'Duplicate tags are redundant and waste space.',
        fix: 'Remove duplicate tag entries from meta.tag.',
    },
    'metadata-tag-short-display': {
        why: 'Very short display may not be helpful to users.',
        fix: 'Consider a more descriptive display value. This is informational.',
    },
    'metadata-tag-code-as-display': {
        why: 'Using code as display doesn\'t add human-readable value.',
        fix: 'Consider adding a meaningful human-readable display.',
    },
    'metadata-tag-long-display': {
        why: 'Very long display may cause UI issues.',
        fix: 'Consider shortening display. Use description for details.',
    },
    'metadata-tag-invalid-display-type': {
        why: 'Tag display must be a string.',
        fix: 'Convert display to string format.',
    },
    'metadata-profile-invalid-array': {
        why: 'meta.profile must be an array of canonical URLs.',
        fix: 'Wrap profile in array: meta: { profile: ["http://..."] }',
    },
    'metadata-profile-invalid-type': {
        why: 'Each profile entry must be a string canonical URL.',
        fix: 'Convert profile to string URL format.',
    },
    'metadata-profile-not-accessible': {
        why: 'Profile URL cannot be accessed or resolved.',
        fix: 'Verify URL is correct. Install the package if needed.',
    },
    'metadata-profile-resource-type-mismatch': {
        why: 'Profile is for a different resource type.',
        fix: 'Use a profile that matches this resource type.',
    },
    'metadata-chronological-order-violation': {
        why: 'Timestamps should be in logical chronological order.',
        fix: 'Verify lastUpdated is not before creation-related timestamps.',
    },
    'metadata-identical-timestamps': {
        why: 'Multiple timestamps with identical values may indicate copy/paste.',
        fix: 'Verify timestamps are correct. This is informational.',
    },
    'metadata-version-id-validation-error': {
        why: 'versionId validation failed for an unspecified reason.',
        fix: 'Check versionId format. Let server manage if unsure.',
    },
    'metadata-last-updated-validation-error': {
        why: 'lastUpdated validation failed for an unspecified reason.',
        fix: 'Check timestamp format. Let server manage if unsure.',
    },
    'metadata-security-missing-system': {
        why: 'Security labels require a system to identify the code\'s origin.',
        fix: 'Add a system URI from a recognized security vocabulary.',
        specUrl: 'https://www.hl7.org/fhir/security-labels.html',
    },
    'metadata-security-missing-code': {
        why: 'Security labels require a code to specify the security classification.',
        fix: 'Add a code from the specified security vocabulary.',
    },
    'metadata-security-invalid-system': {
        why: 'Security system should be a valid URI.',
        fix: 'Use a proper URI format for the security vocabulary.',
    },
    'metadata-profile-invalid-url': {
        why: 'Profile URLs should be valid canonical URLs.',
        fix: 'Use the full canonical URL from the profile\'s StructureDefinition.',
    },
    'metadata-profile-duplicate': {
        why: 'Declaring the same profile multiple times is redundant.',
        fix: 'Remove duplicate profile entries from meta.profile.',
    },
    'metadata-missing-meta': {
        why: 'The meta element provides important resource metadata.',
        fix: 'Add meta with at least profile for profiled resources.',
        patch: { action: 'add', path: 'meta', value: '{ "profile": ["{{profileUrl}}"] }' },
    },
    'metadata-security-invalid-array': {
        why: 'meta.security must be an array of Coding elements.',
        fix: 'Wrap security in array: meta: { security: [{ system: "...", code: "..." }] }',
    },
    'metadata-security-invalid-object': {
        why: 'Each security label must be a valid Coding object.',
        fix: 'Use object format: { system: "...", code: "...", display: "..." }',
    },
    'metadata-security-invalid-code-type': {
        why: 'Security code must be a string.',
        fix: 'Convert code to string format.',
    },
    'metadata-security-invalid-display-type': {
        why: 'Security display must be a string.',
        fix: 'Convert display to string format.',
    },
    'metadata-security-duplicate': {
        why: 'Duplicate security labels are redundant.',
        fix: 'Remove duplicate security label entries.',
    },
    'metadata-security-missing-display': {
        why: 'Display improves human readability of security labels.',
        fix: 'Add a human-readable display name for the security code.',
    },
    'metadata-security-unknown-code': {
        why: 'Unrecognized security code may not be processed correctly.',
        fix: 'Use standard codes from the security vocabulary.',
        specUrl: 'https://www.hl7.org/fhir/valueset-security-labels.html',
    },
    'metadata-security-unknown-system': {
        why: 'Unrecognized security system may indicate a typo or custom vocabulary.',
        fix: 'Use standard system URIs for security labels.',
    },
    'metadata-invalid-meta-type': {
        why: 'meta must be a valid Meta object.',
        fix: 'Ensure meta is an object with valid FHIR Meta properties.',
    },
};
