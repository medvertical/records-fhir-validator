import type { FixSuggestion } from './types.js';
import { CATALOG_METADATA } from './catalog-metadata.js';

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
    'structural-invalid-format': {
        why: 'The primitive value does not match the FHIR format for its declared type.',
        fix: 'Use the FHIR primitive format expected by the element, such as adding seconds and a timezone for dateTime values.',
        example: 'Use 2026-05-15T11:59:02Z instead of 2026-05-15T11:59:02',
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
    'attachment-att1-violation': {
        why: 'Invariant att-1: when Attachment.data is present, contentType is required so receivers know how to decode it.',
        fix: 'Add contentType with the MIME type of the embedded data.',
        example: 'Add "contentType": "application/pdf" next to the base64 data.',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#Attachment',
        patch: { action: 'add', path: '{{fieldPath}}.contentType', value: '(MIME type of the data, e.g. "application/pdf")' },
    },
    'attachment-no-content': {
        why: 'The attachment has neither data nor url, so receivers cannot retrieve any content.',
        fix: 'Provide data (base64) or url pointing to the content — or at least a contentType and/or language describing it.',
        example: 'Add "url": "https://example.org/reports/report.pdf" or an inline base64 "data" value.',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#Attachment',
    },
    'narrative-txt2-violation': {
        why: 'Constraint txt-2: the narrative div must contain some non-whitespace content.',
        fix: 'Add a human-readable summary inside text.div, or remove the text element if no narrative is available.',
        example: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Patient summary</p></div>',
        specUrl: 'https://www.hl7.org/fhir/narrative.html',
    },
    'date-year-implausible': {
        why: 'The year is far outside the plausible range for clinical data, which usually indicates a data entry error.',
        fix: 'Check the date for typos (swapped or missing digits) and correct the year.',
        example: 'Use "2024-03-01" instead of "0224-03-01".',
    },
    'string-whitespace-padding': {
        why: 'Leading or trailing whitespace in string values is usually accidental and breaks exact matching and display.',
        fix: 'Trim the whitespace from the start and end of the value.',
        example: 'Use "Smith" instead of " Smith ".',
        // No patch template: the trimmed value is deliberately absent from the
        // finding (a padded name is clinical content), and the client already
        // holds the resource to trim it locally.
    },
    'decimal-value-out-of-range': {
        why: 'The decimal needs more than 18 digits, which is outside the range commonly supported by FHIR systems and usually indicates a data entry or unit error.',
        fix: 'Check the magnitude and precision of the value; correct the number or its unit.',
        example: 'Use 1.5 (with unit "g") instead of 1e+300.',
        specUrl: 'https://www.hl7.org/fhir/datatypes.html#decimal',
    },
    'language-code-invalid': {
        why: 'Resource.language must be a BCP-47 tag built from IANA-registered subtags so consumers can interpret the content language.',
        fix: 'Replace the value with a registered language tag.',
        example: 'Use "en", "de-CH" or "en-US" instead of "zz-INVALID".',
        specUrl: 'https://www.hl7.org/fhir/resource-definitions.html#Resource.language',
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

    ...CATALOG_METADATA,
};
