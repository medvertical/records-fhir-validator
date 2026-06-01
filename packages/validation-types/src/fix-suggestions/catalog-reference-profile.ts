import type { FixSuggestion } from './types';

export const CATALOG_REFERENCE_PROFILE: Record<string, FixSuggestion> = {
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

};
