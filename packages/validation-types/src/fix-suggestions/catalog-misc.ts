import type { FixSuggestion } from './types.js';
import { CATALOG_VERSION_PROFILE_AND_BEST_PRACTICE } from './catalog-version-profile-and-best-practice.js';

export const CATALOG_MISC: Record<string, FixSuggestion> = {
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
        why: 'Questionnaire invariant que-5: only answer-capable Questionnaire item types can have answerOption or answerValueSet.',
        fix: 'Set item.type to a compatible answer type such as choice/open-choice, coding, decimal, integer, date, dateTime, time, string, or quantity; otherwise remove the answer source.',
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

    ...CATALOG_VERSION_PROFILE_AND_BEST_PRACTICE,
};
