import type { FixSuggestion } from './types.js';

export const CATALOG_VERSION_PROFILE_AND_BEST_PRACTICE: Record<string, FixSuggestion> = {
    'version-deprecated-element': {
        why: 'This element is deprecated in the target FHIR version.',
        fix: 'Consult the FHIR version migration notes for the replacement element.',
    },
    'version-renamed-element': {
        why: 'This element was renamed in a later FHIR version.',
        fix: 'Use the new element name per the migration guide.',
    },
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
