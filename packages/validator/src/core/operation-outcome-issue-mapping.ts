/**
 * HL7 OperationOutcome issue-type mapping.
 *
 * Keeps Records issue-code to HL7 issue-type parity rules out of the
 * OperationOutcome boundary converter. Mapping order matters: first prefix
 * match wins, so preserve more-specific prefixes before generic families.
 */

type Hl7IssueType =
  | 'invalid' | 'structure' | 'required' | 'value' | 'invariant'
  | 'security' | 'login' | 'unknown' | 'expired' | 'forbidden' | 'suppressed'
  | 'processing' | 'not-supported' | 'duplicate' | 'multiple-matches'
  | 'not-found' | 'deleted' | 'too-long' | 'code-invalid' | 'extension'
  | 'too-costly' | 'business-rule' | 'conflict'
  | 'transient' | 'lock-error' | 'no-store' | 'exception' | 'timeout'
  | 'incomplete' | 'throttled'
  | 'informational';

const HL7_ISSUE_TYPES = new Set<string>([
  'invalid', 'structure', 'required', 'value', 'invariant',
  'security', 'login', 'unknown', 'expired', 'forbidden', 'suppressed',
  'processing', 'not-supported', 'duplicate', 'multiple-matches',
  'not-found', 'deleted', 'too-long', 'code-invalid', 'extension',
  'too-costly', 'business-rule', 'conflict',
  'transient', 'lock-error', 'no-store', 'exception', 'timeout',
  'incomplete', 'throttled',
  'informational',
]);

/**
 * Prefix-based mapping: Records code prefix → HL7 issue-type.
 * Checked in order — first match wins. More specific prefixes go first.
 */
const PREFIX_TO_HL7_ISSUE_TYPE: Array<[string, Hl7IssueType]> = [
  // Structural
  ['structural-required-element', 'structure'],
  ['structural-missing-resource-type', 'structure'],
  ['structural-resource-type-mismatch', 'value'],
  ['structural-invalid-json', 'structure'],
  ['structural-cardinality', 'structure'],
  // Java emits `structure` when a profile-allowed type does not match
  // the actual type ("found type string, expected Quantity"), see
  // bb-obs-value-is-not-quantity baseline.
  ['structural-type-mismatch', 'structure'],
  ['structural-unknown-element', 'structure'],
  ['structural-invalid-id', 'invalid'],
  ['structural-empty-array', 'invalid'],
  ['structural-empty-object', 'invalid'],
  ['structural-invalid-uri', 'invalid'],
  ['structural-bundle-fullurl-duplicate', 'business-rule'],
  ['structural-bundle-fullurl-', 'invalid'],
  // Java emits `structure` for Attachment size/data byte length mismatches,
  // see attachment-with-wrong-size baseline.
  ['structural-attachment-size-', 'structure'],
  // Orphan primitive-extension sidecar (`_value: {...}` without `value`).
  // Java emits `invalid` — "The property 'X' is invalid".
  ['structural-orphan-primitive-extension', 'invalid'],
  // Resource-wide element-id uniqueness violation — Java emits these
  // as `business-rule` (see mni-patientOverview-bundle-example1b
  // baseline: "Duplicate id value '1a'", "Duplicate id value '2'").
  ['structural-duplicate-element-id', 'business-rule'],
  ['structural-', 'structure'],

  // Profile
  ['profile-constraint-violation', 'invariant'],
  ['profile-min-value-duration-violation', 'processing'],
  ['profile-max-value-duration-violation', 'processing'],
  ['profile-min-value-violation', 'invalid'],
  ['profile-max-value-violation', 'invalid'],
  ['profile-slice-', 'structure'],
  // Java emits `structure` for unresolvable / non-absolute extension URLs
  // (see R4.uuid-extension-base, R4.patient-extension-bad baselines). Keep
  // these on `structure` so category overlap with the baseline scores.
  ['profile-extension-not-found', 'structure'],
  ['profile-extension-url-not-absolute', 'structure'],
  ['profile-extension-url-missing', 'structure'],
  // Versioned extension URL and its companion fixed-URL mismatch — map
  // to the same OperationOutcome codes Java emits (invalid / value).
  ['profile-extension-url-versioned', 'invalid'],
  ['profile-extension-url-fixed-mismatch', 'value'],
  // Java emits `structure` for "definition allows for the types […] but
  // found type X" (see ips-htmlrefs-backwards baseline).
  ['profile-extension-wrong-value-type', 'structure'],
  ['profile-extension-', 'extension'],
  ['profile-slicing-', 'structure'],
  ['profile-mustsupport-', 'structure'],
  ['profile-not-found', 'structure'],
  ['profile-download', 'transient'],
  ['profile-load-error', 'transient'],
  ['profile-', 'invalid'],

  // Terminology
  ['terminology-binding-', 'code-invalid'],
  ['terminology-valueset-', 'code-invalid'],
  ['terminology-', 'code-invalid'],

  // Reference
  ['reference-empty', 'structure'],
  ['reference-invalid-', 'value'],
  ['reference-type-mismatch', 'value'],
  ['reference-type-unknown', 'value'],
  ['reference-target-type-invalid', 'structure'],
  ['reference-contained-unresolved', 'structure'],
  ['reference-ref1-invariant', 'invariant'],
  ['reference-contained-not-found', 'not-found'],
  ['reference-contained-', 'value'],
  ['reference-not-found', 'not-found'],
  ['reference-circular', 'invalid'],
  ['reference-unresolved', 'not-found'],
  ['reference-recursive-timeout', 'timeout'],
  ['reference-bundle-unresolved', 'invalid'],
  ['reference-bundle-', 'structure'],
  ['reference-', 'invalid'],

  // Metadata
  ['metadata-missing-', 'structure'],
  ['metadata-invalid-', 'value'],
  ['metadata-profile-', 'value'],
  ['metadata-version-id-', 'value'],
  ['metadata-last-updated-', 'value'],
  ['metadata-tag-', 'value'],
  ['metadata-security-', 'value'],
  ['metadata-source-', 'value'],
  ['metadata-chronological-', 'business-rule'],
  ['metadata-', 'value'],

  // Business rules
  ['business-invalid-period-end', 'invariant'],
  ['business-rule-', 'business-rule'],
  ['business-', 'business-rule'],

  // StructureDefinition compliesWith — Java emits these as `invalid`
  // (see R5.cw-card-* / cw-binding-* / cw-constraint-* baselines).
  ['sd-complies-with-', 'invalid'],
  // Pattern-as-instance type constraints (ident-1 etc.) — Java emits
  // these as `invariant` (see R5.cw-slice-adds-base baseline).
  ['sd-pattern-', 'invariant'],

  // Bundle-type semantics (bdl-11 document first-entry, bdl-12 message
  // first-entry, searchset/history/transaction constraints, …). These
  // are normative SHALL rules from the R4 Bundle StructureDefinition
  // that Records enforces via `bundle-validator.ts` rather than via
  // the generic FHIRPath executor, so they get their own family.
  // SearchSet rules: Java emits these as `invalid` (the generic Bundle
  // OperationOutcome category) rather than `business-rule`, so map them
  // explicitly before the catch-all `bundle-` prefix below.
  ['bundle-searchset-missing-self-link', 'invalid'],
  ['bundle-searchset-missing-search-mode', 'invalid'],
  ['bundle-searchset-entry-missing-id', 'invalid'],
  ['bundle-searchset-outcome-wrong-type', 'invalid'],
  ['bundle-searchset-entry-wrong-type', 'invalid'],
  // Java emits `invalid` for the cross-entry / fullUrl family of bundle
  // diagnostics — the catch-all `bundle-` → business-rule fallback below
  // only matches the bdl-11 / bdl-12 SHALLs which Java categorises as
  // business-rule. List specific overrides explicitly.
  ['bundle-cross-entry-reference-missing', 'invalid'],
  // type+id match shadowed by fullUrl rules — Java emits this as
  // `structure` (see ref-policy-default-r4 baseline).
  ['bundle-cross-entry-fullurl-mismatch', 'structure'],
  ['bundle-entry-fullurl-id-mismatch', 'invalid'],
  // Java emits "Bundle entry missing fullUrl" as `required` (the entry
  // SHALL have a fullUrl in document/message/transaction/batch bundles
  // — see bundle-ea-testcase baseline).
  ['bundle-entry-missing-fullurl', 'required'],
  ['bundle-duplicate-entry', 'invalid'],
  // Reachability orphan diagnostic — Java emits these as `informational`
  // even though the severity is error.
  ['bundle-entry-not-reachable', 'informational'],
  ['bundle-', 'business-rule'],

  // Invariant (FHIRPath constraints)
  ['invariant-', 'invariant'],

  // Terminology resource business rules (CodeSystem/ValueSet canonical URLs,
  // caseSensitive, concept definitions, compose.include validation)
  ['terminology-display-mismatch', 'invalid'],
  ['tx-codesystem-url-not-absolute', 'invalid'],
  ['tx-codesystem-url-invalid-uuid', 'invalid'],
  ['tx-codesystem-missing-casesensitive', 'business-rule'],
  ['tx-codesystem-complete-no-concepts', 'business-rule'],
  ['tx-codesystem-supplement-content', 'business-rule'],
  ['tx-codesystem-concept-no-definition', 'business-rule'],
  ['tx-codesystem-property-no-uri', 'business-rule'],
  ['tx-valueset-url-not-absolute', 'invalid'],
  ['tx-valueset-url-invalid-uuid', 'invalid'],
  ['tx-valueset-compose-system-fragment', 'invalid'],
  // Compose filter validation (cluster 3: ValueSet filter property + op + value)
  ['tx-valueset-filter-op-invalid', 'invalid'],
  ['tx-valueset-filter-property-unknown', 'invalid'],
  ['tx-valueset-filter-value-invalid-regex', 'invalid'],
  ['tx-valueset-filter-value-format', 'invalid'],
  ['tx-valueset-filter-value-unknown-code', 'invalid'],
  // ValueSet.expansion best-practice rules — Java emits the missing-
  // parameters/identifier diagnostics as `business-rule` and the
  // unversioned-system warning as `invalid` (see R4.vs-expansion-base).
  ['tx-valueset-expansion-no-parameters', 'business-rule'],
  ['tx-valueset-expansion-no-identifier', 'business-rule'],
  ['tx-valueset-expansion-system-no-version', 'invalid'],
  // ConceptMap target-display validation — see R5.cs-val-cm-base.
  // The tx-only-source info uses `business-rule`; the target-display
  // mismatch uses `required` (Java's category for "expected display").
  ['tx-conceptmap-source-tx-only', 'business-rule'],
  ['tx-conceptmap-target-display-invalid', 'required'],
  // CodeSystem concept property Coding value refers to unknown code in another CS
  ['tx-codesystem-concept-property-code-invalid', 'code-invalid'],

  // Narrative / XHTML
  ['narrative-xxe-detected', 'structure'],
  ['narrative-malformed-xhtml', 'structure'],
  ['narrative-missing-xhtml-namespace', 'structure'],
  ['narrative-invalid-root', 'structure'],
  // textLink extension diagnostics — Java emits each at a distinct
  // category (see ips-link baseline).
  ['narrative-textlink-htmlid-not-found', 'structure'],
  ['narrative-textlink-target-not-found', 'not-found'],
  ['narrative-textlink-uri-no-target', 'invalid'],
  // Companion `txt-1` invariant emitted alongside specific
  // disallowed-element/attribute diagnostics — Java emits this as
  // `invariant` (see ips-htmlrefs-* baselines).
  ['narrative-txt1-violation', 'invariant'],
  ['narrative-', 'invalid'],

  // Canonical resource name-as-identifier invariants (mea-0, cnl-0, …)
  ['canonical-resource-invariant-', 'invariant'],

  // StructureDefinition business rules (WG consistency, status, etc.)
  ['sd-sdf-20-root-slicing', 'invariant'],
  ['sd-root-slicing-invalid', 'invalid'],
  ['sd-eld-19-element-name', 'invariant'],
  ['sd-eld-20-element-name', 'invariant'],
  ['sd-extension-url-mismatch', 'invalid'],
  ['sd-extension-fixed-url-override', 'value'],
  ['sd-context-invalid-element', 'invalid'],
  ['sd-snapshot-error-', 'exception'],
  ['sd-slice-must-support', 'invalid'],
  ['sd-base-circular', 'not-found'],

  // HTML-in-string detection (pat-security-bad-string)
  ['string-security-html', 'invalid'],

  // Conformance harness parity for Java informational notes.
  ['harness-informational', 'informational'],
  ['harness-exception', 'exception'],

  // Questionnaire / QuestionnaireResponse
  ['questionnaire-invariant-', 'invariant'],
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

/** HL7 issue-type CodeSystem URI */
export const HL7_ISSUE_TYPE_SYSTEM = 'http://hl7.org/fhir/issue-type';

/** Records custom code system URI */
export const RECORDS_CODE_SYSTEM = 'https://records.medvertical.com/fhir/issue-code';

// ============================================================================
// Converter Functions
// ============================================================================

/**
 * Map a Records issue code to the HL7 issue-type ValueSet code.
 */
export function mapToHl7IssueType(code: string | undefined): Hl7IssueType {
  if (!code) return 'processing';

  if (HL7_ISSUE_TYPES.has(code)) {
    return code as Hl7IssueType;
  }

  for (const [prefix, hl7Code] of PREFIX_TO_HL7_ISSUE_TYPE) {
    if (code.startsWith(prefix)) {
      return hl7Code;
    }
  }

  // Fallback based on common patterns
  if (code.includes('error') || code.includes('invalid')) return 'invalid';
  if (code.includes('missing') || code.includes('required')) return 'structure';
  if (code.includes('not-found')) return 'not-found';
  if (code.includes('timeout')) return 'timeout';

  return 'processing';
}

/**
 * Normalize Records severity to HL7 OperationOutcome severity.
 * Records uses 'info' internally; HL7 requires 'information'.
 * Records uses 'inherit'; map to 'warning' as safe default.
 */
export function normalizeToHl7Severity(
  severity: string | undefined
): 'fatal' | 'error' | 'warning' | 'information' {
  switch (severity) {
    case 'fatal': return 'fatal';
    case 'error': return 'error';
    case 'warning': return 'warning';
    case 'information': return 'information';
    case 'info': return 'information';
    case 'inherit': return 'warning';
    default: return 'information';
  }
}
