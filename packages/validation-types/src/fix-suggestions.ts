/* eslint-disable max-lines */
/**
 * Fix Suggestions Catalog (Shared)
 *
 * Client-side lookup for validation fix suggestions.
 * Full catalog for tooltip display with structured why/fix/example/specUrl.
 * 
 * Pattern: High Fidelity Presentation / Lean Data
 * - Backend sends only the code
 * - Frontend looks up structured suggestion locally
 */

export interface FixPatch {
    /** What kind of change: add a missing element, replace a wrong value, or remove an invalid one */
    action: 'add' | 'replace' | 'remove';
    /** JSON path template — use {{key}} for interpolation from issue details */
    path: string;
    /** The value/snippet to apply — use {{key}} for interpolation */
    value?: string;
}

export interface FixSuggestion {
    why: string;
    fix: string;
    example?: string;
    specUrl?: string;
    /** Structured patch for concrete remediation (Phase C) */
    patch?: FixPatch;
}

// ============================================================================
// Full Fix Suggestions Catalog
// ============================================================================

export const FixSuggestions: Record<string, FixSuggestion> = {

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

    // -------------------------------------------------------------------------
    // Reference
    // -------------------------------------------------------------------------
    'reference-not-found': {
        why: 'References should point to existing resources for data integrity.',
        fix: 'Verify the referenced resource exists, or create it before referencing.',
        example: 'subject: { reference: "Patient/123" }',
    },
    'reference-type-mismatch': {
        why: 'Reference constraints specify which resource types can be referenced.',
        fix: 'Change the reference to point to an allowed resource type.',
        example: 'Observation.subject should reference Patient, not Practitioner',
        patch: { action: 'replace', path: '{{fieldPath}}.reference', value: '"{{allowed}}/id"' },
    },
    'reference-invalid-format': {
        why: 'FHIR references follow specific formats for routing and resolution.',
        fix: 'Use format: "ResourceType/id" for relative, or full URL for absolute.',
        example: 'reference: "Patient/123" or "https://example.org/fhir/Patient/123"',
        patch: { action: 'replace', path: '{{fieldPath}}.reference', value: '"ResourceType/id"' },
    },
    'reference-empty': {
        why: 'A reference element exists but has no value.',
        fix: 'Add a reference value, or remove the empty reference element.',
    },
    'reference-contained-not-found': {
        why: 'The #id reference points to a contained resource that doesn\'t exist.',
        fix: 'Add the resource to the contained array with matching id.',
        example: 'contained: [{ "resourceType": "Organization", "id": "org1", ... }]',
    },
    'reference-bundle-unresolved': {
        why: 'Reference within bundle cannot be resolved to any entry.',
        fix: 'Add an entry with matching fullUrl, or use a urn:uuid for temporary IDs.',
    },
    'reference-bundle-fullurl-mismatch': {
        why: 'The entry\'s fullUrl doesn\'t match the resource\'s id.',
        fix: 'Ensure fullUrl ends with ResourceType/id matching the resource.',
    },
    'reference-bundle-missing-entries': {
        why: 'Bundle requires an entry array.',
        fix: 'Add the entry array with at least one entry.',
    },
    'reference-bundle-request-missing-method': {
        why: 'Transaction/batch entries need a request method.',
        fix: 'Add method: "POST" (create), "PUT" (update), "DELETE" (delete), or "GET" (read).',
    },
    'reference-bundle-request-missing-url': {
        why: 'Transaction/batch entries need a request URL.',
        fix: 'Add url with the resource path (e.g., "Patient" for POST, "Patient/123" for PUT).',
    },
    'reference-invalid-url': {
        why: 'The reference URL is malformed or invalid.',
        fix: 'Use a valid URL format: absolute URL or relative ResourceType/id.',
    },
    'reference-invalid-contained': {
        why: 'Contained reference should use #id format.',
        fix: 'Use format: { "reference": "#contained-id" }',
    },
    'reference-type-unknown': {
        why: 'Cannot determine the resource type from the reference.',
        fix: 'Include ResourceType in reference (e.g., "Patient/123") or add type field.',
    },
    'reference-contained-type-mismatch': {
        why: 'The contained resource type doesn\'t match allowed types.',
        fix: 'Ensure the contained resource type is allowed for this reference.',
    },
    'reference-bundle-invalid-entries': {
        why: 'Bundle entries are malformed or missing required fields.',
        fix: 'Each entry needs: resource (for non-DELETE) and request (for transaction/batch).',
    },
    'reference-validation-error': {
        why: 'Reference validation failed for an unspecified reason.',
        fix: 'Check reference format, target existence, and type constraints.',
    },
    'reference-circular': {
        why: 'A circular reference chain was detected (A → B → A).',
        fix: 'Break the cycle by removing one of the bidirectional references or using a contained resource.',
    },
    'reference-recursive-timeout': {
        why: 'Reference resolution was aborted because the chain is too deep.',
        fix: 'Simplify the reference graph. Deep chains often indicate a modelling issue.',
    },
    'reference-target-type-invalid': {
        why: 'The referenced resource type is not allowed for this reference element.',
        fix: 'Change the reference to one of the allowed target types defined in the element.',
    },
    'reference-unresolved': {
        why: 'The reference could not be resolved to any known resource.',
        fix: 'Ensure the target resource exists, or use a contained/bundled resource.',
    },
    'reference-bundle-missing-type': {
        why: 'Bundle.type determines processing rules (transaction, batch, document, etc.).',
        fix: 'Add a type from: document | message | transaction | batch | searchset | collection | history',
        example: '{ "resourceType": "Bundle", "type": "collection", ... }',
        specUrl: 'https://www.hl7.org/fhir/bundle.html#type',
        patch: { action: 'add', path: 'Bundle.type', value: '"collection"' },
    },
    'reference-bundle-entry-missing-request': {
        why: 'Transaction and batch Bundles require request element for processing instructions.',
        fix: 'Add request with method (GET/POST/PUT/DELETE) and url.',
        example: 'request: { method: "POST", url: "Patient" }',
        patch: { action: 'add', path: '{{fieldPath}}.request', value: '{ "method": "POST", "url": "{{resourceType}}" }' },
    },
    'reference-bundle-duplicate-fullurl': {
        why: 'fullUrl must be unique within a Bundle for unambiguous reference resolution.',
        fix: 'Ensure each entry has a unique fullUrl, or use urn:uuid for temporary IDs.',
    },

    // -------------------------------------------------------------------------
    // Profile
    // -------------------------------------------------------------------------
    'profile-constraint-violation': {
        why: 'Profile constraints define additional rules beyond the base FHIR specification. In document Bundles this can also mean a referenced child resource failed targetProfile matching.',
        fix: 'Review the path and details. For targetProfile failures, fix the referenced resource so it conforms to one of the allowed targetProfiles, then revalidate the Bundle.',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '(satisfy constraint {{key}}: {{message}})' },
    },
    'profile-mustsupport-missing': {
        why: 'MustSupport elements should be populated when data is available.',
        fix: 'Add the element if you have the data. If not available, document why.',
        specUrl: 'https://www.hl7.org/fhir/conformance-rules.html#mustSupport',
    },
    'profile-slice-min-cardinality': {
        why: 'The profile requires at least one item matching this slice discriminator. For document Bundles, the missing slice may be caused by an entry that exists but does not conform to the required profile.',
        fix: 'Add or repair the element matching the slice. For Bundle.entry:composition, fix the Composition entry and any child targetProfile errors first.',
        example: 'For Bundle.entry:composition: include a Composition entry that conforms to the document profile.',
        patch: { action: 'add', path: '{{fieldPath}}', value: '(add entry matching slice "{{sliceName}}", min={{min}})' },
    },
    'profile-slice-max-cardinality': {
        why: 'The profile limits how many items can match this slice.',
        fix: 'Remove excess elements or verify discriminator values.',
    },
    'profile-slice-closed-unmatched': {
        why: 'Closed slicing rejects elements that don\'t match any defined slice.',
        fix: 'Either match an existing slice discriminator, or request the profile be updated.',
        specUrl: 'https://www.hl7.org/fhir/profiling.html#slicing',
    },
    'profile-extension-url-missing': {
        why: 'Every extension must have a URL identifying its definition.',
        fix: 'Add the url property with the extension\'s canonical URL.',
        example: '{ "url": "http://example.org/fhir/StructureDefinition/my-extension", "valueString": "..." }',
        patch: { action: 'add', path: '{{fieldPath}}.url', value: '"http://example.org/fhir/StructureDefinition/..."' },
    },
    'profile-extension-not-in-profile': {
        why: 'This extension is not defined in the declared profile.',
        fix: 'Remove the extension, or add its definition to the profile.',
    },
    'profile-extension-no-value': {
        why: 'Extensions must have either a value[x] or nested extensions, not neither.',
        fix: 'Add a value using the appropriate type (valueString, valueCode, etc.).',
    },
    'profile-extension-missing': {
        why: 'The profile requires this extension to be present.',
        fix: 'Add the extension with its required URL and value.',
    },
    'profile-not-found': {
        why: 'The profile could not be loaded from the package registry.',
        fix: 'Install the package containing this profile, or verify the canonical URL.',
    },
    'profile-download-failed': {
        why: 'Network or registry error while downloading the profile.',
        fix: 'Check network connectivity and try again. Verify the profile URL is correct.',
    },
    'profile-extension-invalid': {
        why: 'The extension structure is malformed or incomplete.',
        fix: 'Ensure the extension has url and either value[x] or nested extension elements.',
    },
    'profile-extension-modifier-mismatch': {
        why: 'Modifier extensions must use modifierExtension, not extension.',
        fix: 'Move this to modifierExtension array, or use a non-modifier extension definition.',
        specUrl: 'https://www.hl7.org/fhir/extensibility.html#modifierExtension',
    },
    'profile-extension-value-and-nested': {
        why: 'Extensions cannot have both a value[x] and nested extensions.',
        fix: 'Choose either a direct value OR nested extensions, not both.',
    },
    'profile-extension-invalid-value-type': {
        why: 'The extension\'s value type doesn\'t match its definition.',
        fix: 'Use the value type specified in the extension definition (e.g., valueString, valueCode).',
    },
    'profile-extension-max-depth': {
        why: 'Nested extensions exceed the validator\'s maximum traversal depth. This usually indicates a deeply recursive or cyclic extension tree.',
        fix: 'Flatten the extension hierarchy or split the data across multiple siblings. The default limit is 5 levels of nesting.',
    },
    'profile-extension-min-cardinality': {
        why: 'This extension requires a minimum number of occurrences.',
        fix: 'Add additional instances of the extension to meet minimum cardinality.',
    },
    'profile-extension-max-cardinality': {
        why: 'Too many instances of this extension are present.',
        fix: 'Remove excess extension instances to stay within maximum cardinality.',
    },
    'profile-slicing-violation': {
        why: 'The element violates slicing rules defined in the profile.',
        fix: 'Check the slice discriminator and ensure elements match defined slices.',
        specUrl: 'https://www.hl7.org/fhir/profiling.html#slicing',
    },
    'profile-load-error': {
        why: 'The profile could not be loaded or parsed.',
        fix: 'Verify the package is installed. Check for JSON syntax errors if local.',
    },

    // -------------------------------------------------------------------------
    // Narrative
    // -------------------------------------------------------------------------
    'narrative-malformed-xhtml': {
        why: 'Narrative must be valid XHTML for safe rendering.',
        fix: 'Check for unclosed tags, proper nesting, and valid XML structure.',
        example: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Valid narrative</p></div>',
    },
    'narrative-forbidden-content': {
        why: 'Scripts and interactive elements are forbidden for security.',
        fix: 'Remove <script>, <form>, <iframe>, onclick handlers, and javascript: URLs.',
    },
    'narrative-invalid-root': {
        why: 'Narrative must have a <div> root with XHTML namespace.',
        fix: 'Wrap content in: <div xmlns="http://www.w3.org/1999/xhtml">...</div>',
        patch: { action: 'replace', path: 'text.div', value: '"<div xmlns=\\"http://www.w3.org/1999/xhtml\\">...</div>"' },
    },

    // -------------------------------------------------------------------------
    // Business Rules
    // -------------------------------------------------------------------------
    'business-rule-violation': {
        why: 'A clinical or business rule defined for this resource was violated.',
        fix: 'Review the specific rule constraint and adjust your data accordingly.',
    },
    'business-value-out-of-range': {
        why: 'The value falls outside the acceptable range for this measurement.',
        fix: 'Verify the value is correct. If intentional, add interpretation or note.',
    },
    'business-negative-value': {
        why: 'This field typically should not contain negative values.',
        fix: 'Use a positive value, or verify this is intentional for your use case.',
    },
    'business-rule-sp-composite': {
        why: 'A composite SearchParameter business rule was violated.',
        fix: 'Review the composite parameter components and ensure the resource data satisfies all parts.',
    },
    'business-invalid-effective-date': {
        why: 'The effective date format is invalid or illogical.',
        fix: 'Use valid FHIR date/dateTime format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ).',
    },
    'business-future-effective-date': {
        why: 'Clinical observations typically should not have future effective dates.',
        fix: 'Verify the date is correct. If intentional (e.g., scheduled medication), document why.',
    },
    'business-final-status-no-value': {
        why: 'Observations with final status typically require a value.',
        fix: 'Add a value, or use dataAbsentReason if value is legitimately missing.',
        patch: { action: 'add', path: 'Observation.valueQuantity', value: '{ "value": 0, "unit": "...", "system": "http://unitsofmeasure.org" }' },
    },
    'business-invalid-onset-date': {
        why: 'The onset date format is invalid.',
        fix: 'Use valid FHIR date format (YYYY, YYYY-MM, or YYYY-MM-DD).',
    },
    'business-future-onset-date': {
        why: 'Condition onset date is in the future.',
        fix: 'If this is expected onset, consider using a different element.',
    },
    'business-invalid-birth-date': {
        why: 'The birth date format is invalid.',
        fix: 'Use valid date format: YYYY, YYYY-MM, or YYYY-MM-DD.',
    },
    'business-future-birth-date': {
        why: 'Birth date cannot be in the future.',
        fix: 'Correct the birth date to a past or current date.',
    },
    'business-unreasonable-age': {
        why: 'The calculated age seems unrealistic (e.g., >150 years).',
        fix: 'Verify the birth date is correct.',
    },
    'business-end-before-start': {
        why: 'Period.end must be after Period.start for logical consistency.',
        fix: 'Swap the dates or correct the incorrect value.',
    },
    'finished-status-no-end': {
        why: 'Encounters with a "finished" status should record an end timestamp.',
        fix: 'Add Encounter.period.end, or set the status to in-progress if still active.',
    },
    'invalid-status-value': {
        why: 'The status code is not in the allowed value set for this resource.',
        fix: 'Pick a status from the resource\'s defined status value set.',
    },
    'invalid-date-format': {
        why: 'Dates must follow the FHIR date format (YYYY, YYYY-MM, or YYYY-MM-DD).',
        fix: 'Rewrite the value as an ISO-8601 date with no embedded time.',
    },
    'invalid-period-start': {
        why: 'Period.start must be a valid FHIR dateTime.',
        fix: 'Use an ISO-8601 dateTime like 2026-04-08T10:15:30Z.',
    },
    'invalid-period-end': {
        why: 'Period.end must be a valid FHIR dateTime.',
        fix: 'Use an ISO-8601 dateTime like 2026-04-08T10:15:30Z.',
    },

    // -------------------------------------------------------------------------
    // FHIR Core Invariants (dom-*, obs-*, pat-*, ele-*, ref-*, bdl-*, con-*)
    // -------------------------------------------------------------------------
    'dom-6': {
        why: 'FHIR invariant dom-6: a resource should have narrative for robust management.',
        fix: 'Add a populated `text.div` narrative element to the resource.',
        specUrl: 'https://www.hl7.org/fhir/domainresource.html#invs',
    },
    'ele-1-violation': {
        why: 'FHIR invariant ele-1: all FHIR elements must have @value or children.',
        fix: 'Populate the element with a value or remove it if empty.',
    },
    'ref-1-violation': {
        why: 'FHIR invariant ref-1: a Reference.reference must be either a relative or absolute URL.',
        fix: 'Use a proper reference format (ResourceType/id or absolute URL).',
    },
    'obs-3-violation': {
        why: 'FHIR invariant obs-3: a ReferenceRange must have at least a low, high, or text.',
        fix: 'Add one of Observation.referenceRange.low, .high, or .text.',
    },
    'obs-6-violation': {
        why: 'FHIR invariant obs-6: dataAbsentReason SHALL only be present if Observation.value[x] is not present.',
        fix: 'Remove dataAbsentReason when a value is present, or vice versa.',
        patch: { action: 'remove', path: 'Observation.dataAbsentReason' },
    },
    'obs-7-violation': {
        why: 'FHIR invariant obs-7: Observation.value must not be present if Observation.dataAbsentReason is present.',
        fix: 'Remove one of value[x] or dataAbsentReason.',
    },
    'pat-1-violation': {
        why: 'FHIR invariant pat-1: Patient.contact SHALL at least contain a name, a telecom, or an address.',
        fix: 'Populate at least one of name, telecom, or address on Patient.contact.',
    },
    'con-3-violation': {
        why: 'FHIR invariant con-3: Condition.clinicalStatus and verificationStatus pair must be consistent.',
        fix: 'Ensure clinicalStatus and verificationStatus follow the allowed combinations.',
    },
    'con-4-violation': {
        why: 'FHIR invariant con-4: Condition.abatement SHALL only be present if clinicalStatus is resolved, remission, or inactive.',
        fix: 'Remove abatement or update clinicalStatus accordingly.',
    },
    'con-5-violation': {
        why: 'FHIR invariant con-5: Condition.clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error.',
        fix: 'Remove clinicalStatus when verificationStatus is entered-in-error.',
        patch: { action: 'remove', path: 'Condition.clinicalStatus' },
    },
    'bdl-1-violation': {
        why: 'FHIR invariant bdl-1: total is only allowed in search and history bundles.',
        fix: 'Remove Bundle.total or change the Bundle.type to searchset/history.',
    },
    'bdl-2-violation': {
        why: 'FHIR invariant bdl-2: entry.search only when Bundle.type is searchset.',
        fix: 'Remove entry.search or switch the bundle to type searchset.',
    },
    'bdl-3-violation': {
        why: 'FHIR invariant bdl-3: entry.request mandatory for type=transaction/batch/history.',
        fix: 'Add entry.request or switch the bundle type.',
    },
    'bdl-4-violation': {
        why: 'FHIR invariant bdl-4: entry.response mandatory for type=transaction-response/batch-response/history.',
        fix: 'Add entry.response or switch the bundle type.',
    },
    'ait-1-violation': {
        why: 'FHIR invariant ait-1: AllergyIntolerance clinical status must be consistent with verification status.',
        fix: 'Ensure clinicalStatus and verificationStatus follow the allowed combinations.',
    },
    'ait-2-violation': {
        why: 'FHIR invariant ait-2: AllergyIntolerance onset date must be before or at the recorded date.',
        fix: 'Correct the onset or recordedDate so onset does not come after recorded.',
    },
    'cmp-1-violation': {
        why: 'FHIR invariant cmp-1: Composition.section entry must reference a resource.',
        fix: 'Add a valid reference for each Composition.section.entry.',
    },
    'cmp-2-violation': {
        why: 'FHIR invariant cmp-2: A section must have at least one of text, entry, or section.',
        fix: 'Add text, entry, or subsection to the empty Composition.section.',
    },

    // -------------------------------------------------------------------------
    // Bundle-specific structural issues
    // -------------------------------------------------------------------------
    'bundle-validation-error': {
        why: 'Bundle structural validation failed.',
        fix: 'Review the Bundle type, entries, and request/response elements.',
    },
    'bundle-cross-entry-reference-missing': {
        why: 'A reference inside this Bundle entry points to a resource that is not included as an entry in the same Bundle. For document and message Bundles, all referenced resources must be present.',
        fix: 'Add the missing resource as a Bundle entry, or change the reference to point at an existing entry.',
    },
    'bundle-cross-entry-reference-unresolved': {
        why: 'A reference cannot be resolved within this Bundle. The target resource may exist on an external server.',
        fix: 'If the reference should be self-contained, add the target as a Bundle entry. Otherwise this warning is informational.',
    },
    'bundle-duplicate-entry': {
        why: 'The same resource (same resourceType and id) appears more than once in the Bundle.',
        fix: 'Remove the duplicate entry or assign distinct ids.',
    },
    'bundle-document-first-entry': {
        why: 'Document bundles must have Composition as the first entry.',
        fix: 'Re-order entries so the Composition resource comes first.',
    },
    'bundle-document-first-entry-not-composition': {
        why: 'The first entry in a document Bundle must be a Composition resource.',
        fix: 'Move the Composition entry to position 0 in Bundle.entry.',
    },
    'bundle-message-first-entry': {
        why: 'Message bundles must have MessageHeader as the first entry.',
        fix: 'Re-order entries so the MessageHeader resource comes first.',
    },
    'bundle-message-first-entry-not-messageheader': {
        why: 'The first entry in a message Bundle must be a MessageHeader resource.',
        fix: 'Move the MessageHeader entry to position 0 in Bundle.entry.',
    },
    'bundle-entry-missing-fullurl': {
        why: 'Bundle entries should have a fullUrl for reference resolution within the Bundle.',
        fix: 'Add fullUrl as an absolute URL or urn:uuid to the entry.',
    },
    'bundle-history-missing-total': {
        why: 'History bundles should include a `total` field.',
        fix: 'Populate Bundle.total with the total number of matches.',
    },
    'bundle-searchset-missing-total': {
        why: 'Searchset bundles should include a `total` field.',
        fix: 'Populate Bundle.total with the total matches for the search.',
    },
    'bundle-searchset-entry-missing-mode': {
        why: 'Searchset bundle entries should declare entry.search.mode (match, include, outcome).',
        fix: 'Set entry.search.mode explicitly for each entry.',
    },

    // -------------------------------------------------------------------------
    // Contained resource issues
    // -------------------------------------------------------------------------
    'contained-missing-id': {
        why: 'Contained resources must have an id so they can be referenced.',
        fix: 'Add an id to the contained resource.',
        patch: { action: 'add', path: '{{fieldPath}}.id', value: '"contained-1"' },
    },
    'contained-missing-resourcetype': {
        why: 'Contained resources must declare their resourceType.',
        fix: 'Add resourceType to every entry in the contained array.',
    },
    'contained-duplicate-id': {
        why: 'Contained resource ids must be unique within a resource.',
        fix: 'Rename duplicate contained resource ids.',
    },
    'contained-nested-violation': {
        why: 'FHIR forbids nesting contained resources inside contained resources.',
        fix: 'Flatten the contained hierarchy so each contained resource is only one level deep.',
    },
    'contained-unreferenced': {
        why: 'Every contained resource should be referenced by the parent (dom-3).',
        fix: 'Add a reference to the contained resource via #localId or remove it.',
    },
    'contained-reference-type-unknown': {
        why: 'The referenced contained resource\'s type cannot be inferred.',
        fix: 'Fix the parent reference path or add the contained resource.',
    },

    // -------------------------------------------------------------------------
    // Deep binding / terminology traversal
    // -------------------------------------------------------------------------
    'deep-binding-empty-code': {
        why: 'A coded element anywhere in the resource is empty.',
        fix: 'Populate the coding.code (and system) or remove the element.',
    },
    'deep-binding-no-valid-coding': {
        why: 'A CodeableConcept has no coding that matches the required ValueSet.',
        fix: 'Add at least one coding whose system/code is from the required ValueSet.',
    },

    // -------------------------------------------------------------------------
    // Early termination (short-circuit on critical errors)
    // -------------------------------------------------------------------------
    'early-termination-null-resource': {
        why: 'Validation was asked to run on a null/undefined resource.',
        fix: 'Ensure the caller passes a valid FHIR resource object.',
    },
    'early-termination-empty-resource': {
        why: 'Validation was asked to run on an empty object.',
        fix: 'Provide a populated FHIR resource with resourceType and fields.',
    },
    'early-termination-not-object': {
        why: 'FHIR resources must be JSON objects.',
        fix: 'Parse the input to a JS object before passing it to the validator.',
    },
    'early-termination-missing-resourcetype': {
        why: 'Every FHIR resource must declare resourceType.',
        fix: 'Add resourceType at the root of the resource.',
    },
    'early-termination-unknown-resourcetype': {
        why: 'The supplied resourceType is not known in this FHIR version.',
        fix: 'Verify resourceType spelling (case-sensitive) and the FHIR version.',
    },
    'early-termination-missing-id': {
        why: 'A persistent FHIR resource requires an id.',
        fix: 'Add an id to the resource or use a POST create (server assigns id).',
    },
    'early-termination-missing-required': {
        why: 'A required top-level element is missing — aborting further checks.',
        fix: 'Populate the indicated required element and re-run validation.',
    },
    'early-termination-resource-too-large': {
        why: 'The resource exceeds the configured size limit.',
        fix: 'Split large bundles or raise the validator size limit cautiously.',
    },

    // -------------------------------------------------------------------------
    // Markdown field sanity
    // -------------------------------------------------------------------------
    'markdown-too-long': {
        why: 'The markdown value exceeds the configured maximum length.',
        fix: 'Trim the content or move long-form text to an attachment.',
    },
    'markdown-xss-detected': {
        why: 'Markdown content contains an XSS pattern (e.g. <script>).',
        fix: 'Remove embedded scripts. Markdown in FHIR should be plain text / limited HTML.',
    },
    'markdown-javascript-url': {
        why: 'A `javascript:` URL was found in markdown.',
        fix: 'Replace with a normal http/https link or remove.',
    },
    'markdown-raw-html': {
        why: 'Raw HTML inside markdown is restricted for safety.',
        fix: 'Use markdown syntax instead of raw HTML.',
    },
    'markdown-image-not-allowed': {
        why: 'Inline images are not permitted in this markdown field.',
        fix: 'Reference the image via an Attachment or URL instead.',
    },
    'markdown-external-url': {
        why: 'External URLs are flagged for review.',
        fix: 'Verify the external link is trustworthy; inline content when appropriate.',
    },
    'markdown-empty-link': {
        why: 'A markdown link has empty text or target.',
        fix: 'Supply both the link text and the URL.',
    },
    'markdown-heading-skip': {
        why: 'Markdown headings skip levels (e.g. h1 → h3).',
        fix: 'Use sequential heading levels for accessibility.',
    },
    'markdown-unclosed-code': {
        why: 'A fenced code block is not closed.',
        fix: 'Add the closing ``` fence.',
    },

    // -------------------------------------------------------------------------
    // Narrative (text.div) checks
    // -------------------------------------------------------------------------
    'narrative-missing-div': {
        why: 'Narrative.div is required when narrative is present.',
        fix: 'Provide a div element containing the human-readable summary.',
    },
    'narrative-invalid-status': {
        why: 'Narrative.status must be one of generated | extensions | additional | empty.',
        fix: 'Set text.status to a valid narrative status code.',
    },
    'narrative-invalid-element': {
        why: 'The narrative div contains an HTML element not allowed in the limited FHIR XHTML subset.',
        fix: 'Remove or replace the disallowed element.',
        specUrl: 'https://www.hl7.org/fhir/narrative.html',
    },
    'narrative-invalid-attribute': {
        why: 'The narrative div contains an HTML attribute not in the FHIR XHTML whitelist.',
        fix: 'Remove the disallowed attribute from the narrative.',
    },

    // -------------------------------------------------------------------------
    // Questionnaire / QuestionnaireResponse
    // -------------------------------------------------------------------------
    'questionnaire-missing-type': {
        why: 'Every Questionnaire.item must declare its type.',
        fix: 'Set item.type to one of the QuestionnaireItemType codes.',
    },
    'questionnaire-missing-linkid': {
        why: 'Every Questionnaire.item must have a linkId.',
        fix: 'Add a unique linkId to the item.',
    },
    'questionnaire-duplicate-linkid': {
        why: 'linkIds must be unique within a Questionnaire.',
        fix: 'Rename duplicated linkId values.',
    },
    'questionnaire-missing-status': {
        why: 'Questionnaire.status is required.',
        fix: 'Set status to draft, active, retired or unknown.',
    },
    'qr-missing-status': {
        why: 'QuestionnaireResponse.status is required.',
        fix: 'Set QuestionnaireResponse.status to a valid code (in-progress, completed, …).',
    },
    'qr-missing-linkid': {
        why: 'QuestionnaireResponse.item must include the linkId of the question it answers.',
        fix: 'Add item.linkId referring back to the Questionnaire item.',
    },
    'qr-unknown-linkid': {
        why: 'The answer references a linkId that does not exist in the source Questionnaire.',
        fix: 'Align QuestionnaireResponse.item.linkId with the Questionnaire definition.',
    },
    'qr-missing-required': {
        why: 'A required Questionnaire item has no answer.',
        fix: 'Provide an answer for the required item or mark it as data-absent.',
    },
    'qr-type-mismatch': {
        why: 'The answer type does not match the Questionnaire item.type.',
        fix: 'Use the value[x] variant that matches the item.type.',
    },
    'qr-invalid-option': {
        why: 'The selected answer is not one of the allowed answerOption/answerValueSet values.',
        fix: 'Pick an answer from the allowed set.',
    },
    'questionnaire-invariant-que-0': {
        why: 'Questionnaire invariant que-0: Questionnaire.name must be usable as an identifier for the module.',
        fix: 'Set Questionnaire.name to a valid identifier (no spaces, starts with alpha).',
    },
    'questionnaire-invariant-que-1': {
        why: 'Questionnaire invariant que-1: group items must not carry an initial answer.',
        fix: 'Remove initial from group-type items (only leaf items can have answers).',
    },
    'questionnaire-invariant-que-2': {
        why: 'Questionnaire invariant que-2: display items cannot have child items.',
        fix: 'Remove nested item from display-type items or change the type.',
    },
    'questionnaire-invariant-que-3': {
        why: 'Questionnaire invariant que-3: display items cannot have a code.',
        fix: 'Remove code from display-type items.',
    },
    'questionnaire-invariant-que-4': {
        why: 'Questionnaire invariant que-4: a Questionnaire.item with enableWhen must use enableBehavior if there are multiple conditions.',
        fix: 'Add enableBehavior ("all" or "any") when item has multiple enableWhen conditions.',
    },
    'questionnaire-invariant-que-5': {
        why: 'Questionnaire invariant que-5: only "coding" and "quantity" items can have answerOption.',
        fix: 'Set item.type to choice/open-choice or remove the answerOption.',
    },
    'questionnaire-invariant-que-6': {
        why: 'Questionnaire invariant que-6: required items must have items or initial.',
        fix: 'Add initial value or child items to the required item.',
    },
    'questionnaire-invariant-que-7': {
        why: 'Questionnaire invariant que-7: enableWhen.answer must match the enableWhen.question\'s type.',
        fix: 'Use an answer value type that matches the referenced question\'s type.',
    },
    'questionnaire-invariant-que-8': {
        why: 'Questionnaire invariant que-8: initial values are only for leaf items (not groups).',
        fix: 'Remove initial from group items; only set initial on leaf items.',
    },
    'questionnaire-invariant-que-9': {
        why: 'Questionnaire invariant que-9: read-only items should not have an initial value.',
        fix: 'Remove initial from readOnly items or remove the readOnly flag.',
    },
    'questionnaire-invariant-que-10': {
        why: 'Questionnaire invariant que-10: maxLength applies only to string/text/url items.',
        fix: 'Remove maxLength or change item.type to string, text, or url.',
    },
    'questionnaire-invariant-que-11': {
        why: 'Questionnaire invariant que-11: answerValueSet is only valid for choice/open-choice items.',
        fix: 'Set item.type to choice or open-choice, or remove answerValueSet.',
    },
    'questionnaire-invariant-que-12': {
        why: 'Questionnaire invariant que-12: only leaf items may have an answerConstraint.',
        fix: 'Remove answerConstraint from group-type items.',
    },
    'questionnaire-sdc-maxvalue': {
        why: 'SDC extension: the answer exceeds the declared maximum value.',
        fix: 'Lower the answer to the declared maximum or update the maxValue extension.',
    },
    'questionnaire-sdc-minvalue': {
        why: 'SDC extension: the answer is below the declared minimum value.',
        fix: 'Raise the answer to the declared minimum or update the minValue extension.',
    },

    // -------------------------------------------------------------------------
    // Security & PHI leakage
    // -------------------------------------------------------------------------
    'security-validator-error': {
        why: 'A security sub-check (PHI detection, sensitive identifier scan, security label compliance, audit-trail validation, or custom pattern scan) threw an error and could not complete.',
        fix: 'Treat the resource as security-unverified and investigate the error details. Do not rely on other security issues being complete when this error is present.',
    },
    'security-missing-labels': {
        why: 'The resource category usually requires security labels.',
        fix: 'Add appropriate meta.security entries (e.g. Confidentiality codes).',
        specUrl: 'https://www.hl7.org/fhir/security-labels.html',
    },
    'security-missing-confidentiality': {
        why: 'A confidentiality label is recommended for sensitive data.',
        fix: 'Add a Confidentiality coding under meta.security.',
    },
    'security-audit-missing-source': {
        why: 'AuditEvent.source is required for audit integrity.',
        fix: 'Populate AuditEvent.source.observer with a reference to the source.',
    },
    'security-audit-missing-lastupdated': {
        why: 'AuditEvent resources should track their creation time.',
        fix: 'Populate meta.lastUpdated on the AuditEvent.',
    },
    'security-phi-ssn-detected': {
        why: 'A Social Security Number pattern was detected in a free-text field.',
        fix: 'Remove PHI from free text; store identifiers in Identifier fields instead.',
    },
    'security-phi-phone-in-narrative': {
        why: 'A phone number was detected in the narrative.',
        fix: 'Move contact details into Patient.telecom rather than narrative.',
    },
    'security-phi-email-in-narrative': {
        why: 'An email address was detected in the narrative.',
        fix: 'Move email details into the appropriate telecom element.',
    },
    'security-phi-address-in-narrative': {
        why: 'A postal address was detected in the narrative.',
        fix: 'Move address details into structured Address elements.',
    },
    'security-phi-dob-in-narrative': {
        why: 'A date of birth pattern was detected in the narrative.',
        fix: 'Store DOB in Patient.birthDate, not in narrative text.',
    },
    'security-sensitive-ssn-identifier': {
        why: 'SSNs should carry a restricted/confidentiality security label.',
        fix: 'Add an appropriate meta.security label to the resource.',
    },
    'security-sensitive-cc-identifier': {
        why: 'Credit card numbers should not be stored in FHIR at all.',
        fix: 'Remove the credit card identifier; use a token or do not store the value.',
    },

    // -------------------------------------------------------------------------
    // Provenance chain
    // -------------------------------------------------------------------------
    'provenance-missing-target': {
        why: 'Provenance.target is required and must reference the resource(s) the Provenance describes.',
        fix: 'Add at least one entry to Provenance.target referencing the subject resource.',
    },
    'provenance-target-invalid': {
        why: 'A Provenance.target entry is not a valid Reference object.',
        fix: 'Use `{ "reference": "ResourceType/id" }` (or identifier) for each target.',
    },
    'provenance-target-missing-reference': {
        why: 'A Provenance.target must contain a reference or an identifier.',
        fix: 'Add target.reference or target.identifier so the target is identifiable.',
    },
    'provenance-target-malformed-reference': {
        why: 'Provenance.target.reference is not a well-formed FHIR reference.',
        fix: 'Use ResourceType/id, an absolute URL, or a urn:uuid: placeholder.',
    },
    'provenance-missing-recorded': {
        why: 'Provenance.recorded is required — it records when the provenance was captured.',
        fix: 'Set Provenance.recorded to the current instant when the record is created.',
    },
    'provenance-invalid-recorded': {
        why: 'Provenance.recorded must be a FHIR instant (ISO 8601 with timezone).',
        fix: 'Use e.g. 2026-04-08T10:15:30Z.',
    },
    'provenance-missing-agent': {
        why: 'Provenance.agent requires at least one entry — someone must be the author.',
        fix: 'Add an agent entry with who.reference pointing to the actor.',
    },
    'provenance-agent-missing-who': {
        why: 'Provenance.agent.who should identify the actor (reference or identifier).',
        fix: 'Populate agent.who.reference (preferred) or agent.who.identifier.',
    },
    'provenance-agent-malformed-reference': {
        why: 'Provenance.agent.who.reference is not a well-formed FHIR reference.',
        fix: 'Use ResourceType/id, an absolute URL, or a urn:uuid: placeholder.',
    },
    'provenance-recorded-before-event': {
        why: 'The recorded timestamp precedes the event occurred date/time.',
        fix: 'Ensure recorded is at or after the described activity.',
    },

    // -------------------------------------------------------------------------
    // Version / schema evolution
    // -------------------------------------------------------------------------
    'version-deprecated-element': {
        why: 'This element is deprecated in the target FHIR version.',
        fix: 'Consult the FHIR version migration notes for the replacement element.',
    },
    'version-renamed-element': {
        why: 'This element was renamed in a later FHIR version.',
        fix: 'Use the new element name per the migration guide.',
    },

    // -------------------------------------------------------------------------
    // Profile sizing / constraints
    // -------------------------------------------------------------------------
    'profile-min-length': {
        why: 'The value is shorter than the profile\'s minimum length constraint.',
        fix: 'Provide a value that satisfies the minLength constraint.',
    },
    'profile-max-length': {
        why: 'The value exceeds the profile\'s maximum length constraint.',
        fix: 'Shorten the value to satisfy the maxLength constraint.',
    },
    'profile-max-length-exceeded': {
        why: 'The value exceeds the profile\'s maximum length constraint.',
        fix: 'Shorten the value to satisfy the maxLength constraint.',
    },
    'profile-min-value-violation': {
        why: 'The value is below the profile\'s minValue constraint.',
        fix: 'Use a value at or above the minValue.',
    },
    'profile-max-value-violation': {
        why: 'The value exceeds the profile\'s maxValue constraint.',
        fix: 'Use a value at or below the maxValue.',
    },
    'profile-required-binding-violation': {
        why: 'The profile requires a code from a specific ValueSet (required binding).',
        fix: 'Replace the code with one allowed by the profile\'s required binding.',
        patch: { action: 'replace', path: '{{fieldPath}}', value: '(use a code from the profile\'s required ValueSet)' },
    },
    'profile-not-declared': {
        why: 'The validator was asked to use a profile that is not declared on the resource.',
        fix: 'Add the profile URL to meta.profile, or pass it as a profile parameter.',
    },
    'profile-constraint-evaluation-error': {
        why: 'A FHIRPath constraint on the profile failed to evaluate.',
        fix: 'Check the invariant expression against the resource. Fix the data or the expression.',
    },
    'profile-load-skipped': {
        why: 'A profile load was skipped because the configuration excluded it.',
        fix: 'Informational — adjust profile resolver settings if you expected the profile to load.',
    },
    'profile-validation-error': {
        why: 'Profile validation failed for an unspecified reason.',
        fix: 'Review the associated details. Consider re-downloading the profile.',
    },

    // -------------------------------------------------------------------------
    // Misc / transport errors
    // -------------------------------------------------------------------------
    'network-error': {
        why: 'A network request during validation failed.',
        fix: 'Check connectivity. The validator will degrade to cache when possible.',
    },
    'invalid-url-format': {
        why: 'The URL is not a valid RFC 3986 URL.',
        fix: 'Use a proper URL scheme and encoding (e.g. https://example.org/fhir).',
    },
    'unknown-error': {
        why: 'An unexpected error was raised by the validator.',
        fix: 'Check server logs for details; the input may expose a validator bug.',
    },
    'infrastructure-error': {
        why: 'An infrastructure-level error occurred during validation (e.g., timeout, memory).',
        fix: 'Retry the validation. If persistent, check server resources and logs.',
    },
    'string-security-html': {
        why: 'An HTML tag was detected in a FHIR string field. Plain string elements should not contain HTML.',
        fix: 'Move HTML content to a narrative (text.div) or markdown field. Strip tags from the string.',
    },

    // -------------------------------------------------------------------------
    // FHIR Best Practices (optional, surfaced by BestPracticeValidator)
    // -------------------------------------------------------------------------
    'best-practice-missing-effective': {
        why: 'This clinical resource is more useful when it carries an effective date/time.',
        fix: 'Populate `effectiveDateTime` (or `effectivePeriod`) where known.',
    },
    'best-practice-missing-performer': {
        why: 'Clinical resources benefit from recording who performed the action.',
        fix: 'Populate `performer` with a reference to the Practitioner/Organization.',
    },
    'best-practice-observation-method': {
        why: 'Observation.method clarifies how a measurement was obtained.',
        fix: 'Add `method` when the observation technique is known.',
    },
    'best-practice-observation-interpretation': {
        why: 'Interpretation codes (high/low/normal) make observations easier to consume.',
        fix: 'Add Observation.interpretation with a coded interpretation.',
    },
    'best-practice-condition-code-display': {
        why: 'Condition.code.coding entries should include a human-readable display.',
        fix: 'Add `display` alongside the code so downstream consumers can render it.',
    },
    'best-practice-condition-clinical-status': {
        why: 'Condition.clinicalStatus should be explicitly stated for active conditions.',
        fix: 'Set Condition.clinicalStatus (active, recurrence, resolved, …).',
    },
    'best-practice-diagreport-effective': {
        why: 'DiagnosticReports are more useful with an effective time.',
        fix: 'Populate DiagnosticReport.effectiveDateTime or effectivePeriod.',
    },
    'best-practice-diagreport-issued': {
        why: 'DiagnosticReport.issued records when the report was released.',
        fix: 'Populate DiagnosticReport.issued with the release instant.',
    },
    'best-practice-encounter-period': {
        why: 'Encounter.period is required to know when the encounter took place.',
        fix: 'Populate Encounter.period with at minimum a start time.',
    },
    'best-practice-encounter-class': {
        why: 'Encounter.class is required to distinguish inpatient vs. outpatient etc.',
        fix: 'Set Encounter.class with a code from the v3 ActEncounterCode value set.',
    },
    'best-practice-patient-identifier': {
        why: 'Patient resources should carry at least one business identifier.',
        fix: 'Add Patient.identifier with an appropriate system and value.',
    },
    'best-practice-patient-name': {
        why: 'Patient resources should include a name (or an explicit data-absent-reason).',
        fix: 'Populate Patient.name with at least `family` or `given`.',
    },
};

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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get fix suggestion for a validation code.
 *
 * Resolution order:
 *   1. Exact match in `FixSuggestions`
 *   2. Alias match in `FIX_SUGGESTION_ALIASES` → `FixSuggestions`
 *   3. Prefix-stripping heuristic (e.g. `structural-foo` → `foo`)
 *   4. `undefined` (caller may then fall back to `getAspectFallback`)
 */
export function getFixSuggestion(code: string): FixSuggestion | undefined {
    if (!code) return undefined;

    const direct = FixSuggestions[code];
    if (direct) return direct;

    const aliased = FIX_SUGGESTION_ALIASES[code];
    if (aliased) {
        const suggestion = FixSuggestions[aliased];
        if (suggestion) return suggestion;
    }

    // Prefix-stripping heuristic: `structural-cardinality-min` → try
    // `cardinality-min` as a last resort. This is cheap and helps when
    // callers flip-flop between prefixed and unprefixed code naming.
    const dashIndex = code.indexOf('-');
    if (dashIndex > 0) {
        const suffix = code.slice(dashIndex + 1);
        const stripped = FixSuggestions[suffix];
        if (stripped) return stripped;
    }

    return undefined;
}

/**
 * Get a fallback suggestion based on aspect
 */
export function getAspectFallback(aspect: string | undefined): FixSuggestion | undefined {
    if (!aspect) return undefined;
    return ASPECT_FALLBACKS[aspect];
}

/**
 * Format fix suggestion as a single string for display
 */
export function formatFixSuggestion(code: string): string | undefined {
    const suggestion = getFixSuggestion(code);
    if (!suggestion) return undefined;

    let result = `**Why:** ${suggestion.why}\n**Fix:** ${suggestion.fix}`;
    if (suggestion.example) {
        result += `\n**Example:** ${suggestion.example}`;
    }
    return result;
}

/**
 * Resolve a patch template by interpolating {{key}} placeholders with values
 * from the issue's details object.
 *
 * Returns a new FixPatch with concrete values, or null if required
 * placeholders could not be resolved.
 */
export function resolvePatch(
    patch: FixPatch,
    details?: Record<string, unknown>,
): FixPatch | null {
    const interpolate = (template: string): string => {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
            const val = details?.[key];
            if (val === undefined || val === null) return `{{${key}}}`;
            return typeof val === 'object' ? JSON.stringify(val) : String(val);
        });
    };

    const resolved: FixPatch = {
        action: patch.action,
        path: interpolate(patch.path),
    };
    if (patch.value !== undefined) {
        resolved.value = interpolate(patch.value);
    }

    // If any placeholder remains unresolved, the patch is incomplete
    const hasUnresolved = /\{\{\w+\}\}/.test(resolved.path)
        || (resolved.value !== undefined && /\{\{\w+\}\}/.test(resolved.value));
    return hasUnresolved ? null : resolved;
}
