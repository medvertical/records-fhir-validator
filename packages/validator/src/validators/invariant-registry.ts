/**
 * Invariant Registry
 * ------------------
 *
 * Single source of truth for "which constraint keys are owned by a
 * hand-written Records validator, and therefore must NOT be
 * double-evaluated by the generic FHIRPath executor".
 *
 * Before this file, `sd-fhirpath-executor.ts` carried **two** identical
 * hard-coded skip lists (lines 154 and 306 — see Sub-Phase 2d notes),
 * and adding a new specialised handler meant remembering to touch
 * both sites. Miss one and you either silently double-report the
 * constraint or silently skip it, depending which code path fires.
 *
 * The registry collapses that duplication. Every call site goes
 * through `InvariantRegistry.isSpecialised(key)` and the list lives
 * here, alphabetised and annotated.
 *
 * If you add a new specialised invariant handler anywhere in
 * `validators/`, register the key(s) here in the same commit.
 */

/**
 * Maps constraint key → name of the Records file that owns the
 * specialised handler. The value is informational (grep target); the
 * key set is what the dispatcher consults.
 *
 * Source of truth — keep alphabetical by key prefix.
 */
const SPECIALISED_INVARIANT_HANDLERS: Record<string, string> = {
  // Bundle: entry.type + request/response semantics (bdl-1..4 live in
  // resource-specific-constraints-validator.ts). bdl-7 (fullUrl
  // uniqueness) is handled by the structural `BundleValidator` which
  // emits `structural-bundle-fullurl-duplicate`. bdl-8..12 are also in
  // `BundleValidator` because they need Bundle-entry context and Java-parity
  // diagnostics rather than generic FHIRPath output.
  'bdl-1': 'resource-specific-constraints-validator.ts',
  'bdl-2': 'resource-specific-constraints-validator.ts',
  'bdl-3': 'resource-specific-constraints-validator.ts',
  'bdl-4': 'resource-specific-constraints-validator.ts',
  'bdl-7': 'bundle-validator.ts',
  'bdl-8': 'bundle-validator.ts',
  'bdl-9': 'bundle-validator.ts',
  'bdl-10': 'bundle-validator.ts',
  'bdl-11': 'bundle-validator.ts',
  'bdl-12': 'bundle-validator.ts',

  // Condition: clinicalStatus / verificationStatus + stage semantics.
  'con-3': 'resource-specific-constraints-validator.ts',
  'con-4': 'resource-specific-constraints-validator.ts',
  'con-5': 'resource-specific-constraints-validator.ts',

  // DomainResource: contained resource restrictions + narrative
  // presence. dom-2..dom-5 are errors; dom-6 is a best-practice
  // warning handled by best-practice-validator.ts.
  'dom-2': 'constraint-validator.ts',
  'dom-3': 'constraint-validator.ts',
  'dom-4': 'constraint-validator.ts',
  'dom-5': 'constraint-validator.ts',
  'dom-6': 'best-practice-validator.ts',

  // Universal Element constraint — every FHIR element must have a
  // @value or children. Checked in universal-constraints-validator.ts
  // so the generic executor doesn't re-fire it on every nested field.
  'ele-1': 'universal-constraints-validator.ts',

  // Universal Extension constraint — extension.url must be a URI and
  // extension must have either extension.* or value[x], not both.
  //
  // Specialised because the FHIRPath expression
  //   `extension.exists() != value.exists()`
  // uses the polymorphic `value` element which fhirpath.js cannot
  // resolve on raw JS objects — JS has `valueString`, `valueQuantity`,
  // etc., not a literal `value` property. fhirpath.js evaluates
  // `value.exists()` against a non-existent property → returns false →
  // an extension with `valueString="foo"` and no nested `extension`
  // gets `extension.exists()=false`, `value.exists()=false`,
  // `false != false` → constraint violated. Result: a false positive on
  // every well-formed extension that uses a typed value[x].
  //
  // The `ExtensionValidator.validateExtensionStructure` and
  // `ComplexTypeValidator.checkExt1` paths cover the same semantics
  // correctly via JS introspection on `value*` keys.
  'ext-1': 'extension-validator.ts',

  // Observation: componentdataAbsentReason / referenceRange /
  // value-vs-code disambiguation.
  'obs-3': 'resource-specific-constraints-validator.ts',
  'obs-6': 'resource-specific-constraints-validator.ts',
  'obs-7': 'resource-specific-constraints-validator.ts',

  // Patient: contact SHALL have at least one of name/telecom/address/
  // organization.
  'pat-1': 'resource-specific-constraints-validator.ts',

  // Universal Reference constraint — reference string must be a
  // fragment, literal URL, or URN. Checked in
  // universal-constraints-validator.ts.
  'ref-1': 'universal-constraints-validator.ts',
};

// Note: canonical-resource naming invariants (`mea-0`, `csd-0`, `cnl-0`,
// `sev-0`, `apr-1`, …) are handled by
// `canonical-resource-invariant-validator.ts`, but they are ALSO
// severity=warning in the R4 base package and do not currently appear
// in the generic executor's skip path. Deliberately leaving them out
// of this registry preserves existing behaviour — the generic
// executor already treats most of them as a no-op because they are
// warnings rather than errors. If a future refactor flips them to
// error-severity evaluation, they should be registered here per-key.

export const InvariantRegistry = {
  /**
   * Does Records have a dedicated specialised validator for this
   * constraint key? If true, the generic FHIRPath executor must NOT
   * evaluate this constraint (doing so would double-report it).
   */
  isSpecialised(key: string | undefined): boolean {
    if (!key) return false;
    return key in SPECIALISED_INVARIANT_HANDLERS;
  },

  /**
   * Which file owns the specialised handler for this key? Returns
   * undefined if the key is not specialised. Informational only —
   * dispatch uses `isSpecialised`.
   */
  getHandlerFile(key: string | undefined): string | undefined {
    if (!key) return undefined;
    return SPECIALISED_INVARIANT_HANDLERS[key];
  },

  /**
   * Full list of specialised keys, for diagnostics (e.g. spec-coverage
   * reporting + the KNOWN_GAPS cross-reference).
   */
  listSpecialisedKeys(): string[] {
    return Object.keys(SPECIALISED_INVARIANT_HANDLERS).sort();
  },
};
