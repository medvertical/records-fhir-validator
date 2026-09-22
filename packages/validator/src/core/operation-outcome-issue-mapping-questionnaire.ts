import type { Hl7IssueType } from './operation-outcome-issue-types.js';

/**
 * Questionnaire / QuestionnaireResponse prefix mappings, spread into the main
 * PREFIX_TO_HL7_ISSUE_TYPE table. Same contract: order matters, first prefix
 * match wins, more specific prefixes come first.
 */
export const QUESTIONNAIRE_PREFIX_TO_HL7_ISSUE_TYPE: Array<[string, Hl7IssueType]> = [
  ['questionnaire-invariant-', 'invariant'],
  ['questionnaire-reference-wrong-type', 'invalid'],
  ['questionnaire-missing-', 'structure'],
  ['questionnaire-duplicate-', 'invariant'],
  // SDC minOccurs/maxOccurs → invalid (Java uses code=invalid for count violations)
  ['questionnaire-sdc-maxoccurs', 'invalid'],
  ['questionnaire-sdc-minoccurs', 'invalid'],
  // SDC extensions (minValue / maxValue / minLength / maxLength / regex)
  // use the `invariant` HL7 category because Java flags them as
  // constraint violations (see R4.date-min-max-qr-base.json).
  ['questionnaire-sdc-', 'invariant'],
  ['questionnaire-', 'structure'],
  ['qr-missing-', 'structure'],
  // Coding answer display disagrees with the canonical display for the
  // code (Java: code=invalid, e.g. "Wrong Display Name 'Australia' for
  // http://hl7.org/fhir/item-type#string. Valid display is 'String'").
  ['qr-display-mismatch', 'invalid'],
  // Coding answer's code is not in the ValueSet bound via answerValueSet
  // (Java: code=code-invalid, paired with display-mismatch when both apply).
  ['qr-code-not-in-valueset', 'code-invalid'],
  // Java treats QR answer option mismatches as invariant failures
  // (e.g. "The code http://example.org::c3 is not in the set of
  // permitted values", see choice-answer-option-qr baseline).
  ['qr-invalid-option', 'invariant'],
  ['qr-exclusive-option', 'invariant'],
  // Java treats QR answer type mismatches as invariant failures against
  // the item's declared type (see date-invalid-type-qr baseline).
  ['qr-type-mismatch', 'invariant'],
  // Non-repeating items with multiple answers (Java: code=invalid)
  ['qr-repeats-violation', 'invalid'],
  // Required group with no sub-items (Java: code=invariant)
  ['qr-required-group', 'invariant'],
  ['qr-unknown-linkid', 'structure'],
  ['qr-', 'structure'],
];
