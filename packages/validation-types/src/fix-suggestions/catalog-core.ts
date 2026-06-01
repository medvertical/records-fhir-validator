import type { FixSuggestion } from './types';

export const CATALOG_CORE: Record<string, FixSuggestion> = {
    // -------------------------------------------------------------------------
    // Terminology
    // -------------------------------------------------------------------------
    'terminology-binding-required': {
        why: 'Required bindings must use codes from the specified ValueSet for interoperability.',
        fix: 'Replace the code with one from the required ValueSet. Check the ValueSet definition for allowed codes.',
        example: 'Use "active" instead of "Active" for Patient.status',
        specUrl: 'https://www.hl7.org/fhir/terminologies.html#required',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '(use a code from {{valueSet}})' },
    },
    'terminology-binding-extensible': {
        why: 'Extensible bindings prefer codes from the ValueSet, but allow extensions for missing concepts.',
        fix: 'If your concept exists in the ValueSet, use it. Otherwise, document why a custom code is needed.',
        specUrl: 'https://www.hl7.org/fhir/terminologies.html#extensible',
    },
    'terminology-binding-preferred': {
        why: 'Preferred bindings recommend using codes from the ValueSet for better interoperability.',
        fix: 'Consider using a code from the preferred ValueSet. Custom codes are allowed but reduce consistency.',
        specUrl: 'https://www.hl7.org/fhir/terminologies.html#preferred',
    },
    'terminology-binding-example': {
        why: 'Example bindings suggest possible codes but impose no constraints.',
        fix: 'This is informational only. Your code is valid, but check if the example codes better fit your use case.',
    },
    'terminology-binding-required-code': {
        why: 'This primitive code element must use a value from the required binding.',
        fix: 'Use one of the allowed code values. Check the element definition for the list.',
        example: 'For status: use "active", "inactive", or "entered-in-error"',
    },
    'terminology-binding-extensible-code': {
        why: 'Prefer standard codes for primitive code elements to improve interoperability.',
        fix: 'If a standard code fits, use it. Document why a custom code is needed if not.',
    },
    'terminology-binding-preferred-code': {
        why: 'Preferred codes suggest standard values for better consistency.',
        fix: 'Consider using the preferred code if it fits. This is informational.',
    },
    'terminology-binding-example-code': {
        why: 'Example codes show typical usage but are not required.',
        fix: 'This is informational only. Your code is valid.',
    },
    'terminology-binding-missing': {
        why: 'A required coded element is missing its code value.',
        fix: 'Add the required code from the bound ValueSet.',
    },
    'terminology-valueset-error': {
        why: 'Could not validate against the ValueSet (lookup failed).',
        fix: 'Check terminology server connectivity. The code may still be valid.',
    },
    'terminology-code-invalid': {
        why: 'The code is not valid for the declared code system. For UCUM quantities, the code must be a machine-readable UCUM expression, not just the display text.',
        fix: 'Replace the code with a valid code from the declared system. If the issue contains a suggestedCode, use that value; for pH this is typically "[pH]".',
        example: 'For system "http://unitsofmeasure.org", use code "[pH]" instead of "pH".',
        specUrl: 'https://www.hl7.org/fhir/terminologies.html',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '{{suggestedCode}}' },
    },
    'terminology-display-mismatch': {
        why: 'The code may be valid, but the display text does not match the terminology server display for that code.',
        fix: 'Replace the display with an accepted display from the terminology server, or omit display and let consumers render the code.',
        example: 'Keep system/code stable and update only Coding.display.',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#Coding',
    },
    'terminology-coding-system-valueset': {
        why: 'Coding.system must identify the CodeSystem that defines the code. A ValueSet URL describes an allowed set of codes and is not valid as Coding.system.',
        fix: 'Replace Coding.system with the canonical CodeSystem URL for the selected code. Keep the ValueSet only in profile bindings or documentation.',
        example: 'Use "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus" instead of "http://hl7.org/fhir/ValueSet/marital-status".',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#Coding',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '(use the code system URL for this code)' },
    },

    // -------------------------------------------------------------------------
    // Structural
    // -------------------------------------------------------------------------
    'structural-required-element-missing': {
        why: 'Required elements (min=1) must be present for the resource to be valid.',
        fix: 'Add the missing element with a valid value.',
        example: 'Add Patient.name: [{ "family": "Doe", "given": ["John"] }]',
        patch: { action: 'add', path: '{{fieldPath}}', value: '(required — see element definition for type)' },
    },
    'structural-cardinality-min': {
        why: 'The element requires a minimum number of values.',
        fix: 'Add more values to meet the minimum cardinality requirement.',
    },
    'structural-cardinality-max': {
        why: 'The element has exceeded the maximum allowed values.',
        fix: 'Remove excess values or consolidate them as appropriate.',
    },
    'structural-type-mismatch': {
        why: 'The value type must match what the FHIR specification expects.',
        fix: 'Change the value to the correct type. Check the element definition for allowed types.',
        example: 'birthDate should be "1990-01-15" (string), not 1990 (number)',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '(change to type {{expectedType}})' },
    },
    'structural-invalid-json': {
        why: 'The resource cannot be parsed as valid JSON.',
        fix: 'Check for syntax errors: missing quotes, commas, brackets, or trailing commas.',
    },
    'structural-unknown-element': {
        why: 'This element is not defined in the FHIR specification for this resource type.',
        fix: 'Remove the unknown element, or use an extension if custom data is needed.',
    },
    'structural-resource-type-mismatch': {
        why: 'The resourceType does not match the expected type for this context.',
        fix: 'Correct the resourceType field to match the expected type.',
    },
    'structural-missing-resource-type': {
        why: 'Every FHIR resource must have a resourceType field.',
        fix: 'Add resourceType at the root: { "resourceType": "Patient", ... }',
        patch: { action: 'add', path: 'resourceType', value: '"{{resourceType}}"' },
    },
    'structural-cardinality-violation': {
        why: 'The element count violates the cardinality constraint.',
        fix: 'Add or remove elements to meet the min/max requirements.',
    },
    'structural-validation-error': {
        why: 'Structural validation failed for an unspecified reason.',
        fix: 'Check the resource structure against the FHIR specification.',
    },
    'structural-empty-array': {
        why: 'FHIR arrays must contain at least one element if present.',
        fix: 'Remove the empty array or add at least one entry.',
    },
    'structural-invalid-id': {
        why: 'Resource id must match the FHIR id pattern: [A-Za-z0-9\\-._]{1,64}.',
        fix: 'Use only alphanumeric characters, hyphens, dots, and underscores (max 64 chars).',
    },
    'structural-attachment-size-mismatch': {
        why: 'Attachment.size does not match the actual byte count of Attachment.data.',
        fix: 'Recalculate size from the decoded base64 data length and set it correctly.',
    },
    'structural-bundle-fullurl-duplicate': {
        why: 'Each Bundle entry must have a unique fullUrl for unambiguous reference resolution.',
        fix: 'Assign a unique fullUrl to each entry (use urn:uuid for temporary IDs).',
    },
    'structural-bundle-fullurl-invalid': {
        why: 'The fullUrl value is not a valid URI.',
        fix: 'Use an absolute URL (https://...) or urn:uuid:... format.',
    },
    'structural-bundle-fullurl-not-absolute': {
        why: 'Bundle entry fullUrl must be an absolute URI, not a relative path.',
        fix: 'Prefix with the server base URL or use a urn:uuid identifier.',
    },
    'structural-hapi-error': {
        why: 'The HAPI FHIR validator reported an error.',
        fix: 'Review the error details and fix the indicated issue.',
    },
    'structural-invalid-uri': {
        why: 'The URI format is invalid per RFC 3986.',
        fix: 'Use a valid URI format with proper scheme and encoding.',
        example: 'https://example.org/fhir or urn:uuid:...',
    },
    'validation-error': {
        why: 'General validation error.',
        fix: 'Review the error message for specific guidance.',
    },

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------
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
        why: 'versionId and resource id serve different purposes.',
        fix: 'Use a separate version identifier, typically sequential numbers.',
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
