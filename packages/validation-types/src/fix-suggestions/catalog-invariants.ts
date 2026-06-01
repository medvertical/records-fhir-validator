import type { FixSuggestion } from './types';

export const CATALOG_INVARIANTS: Record<string, FixSuggestion> = {
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

};
