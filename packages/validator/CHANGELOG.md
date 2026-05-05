# Changelog

All notable changes to `@records-fhir/validator` are documented in this
file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The companion `@records-fhir/validation-types` and
`@records-fhir/bundled-profiles` packages share this changelog when they
ship together; package-only changes are noted under each release.

## [Unreleased]

### Engine

- `compliesWithProfile` now checks `required`/`extensible`
  binding ValueSet compatibility for `cw-binding-*` fixtures. Simple
  inline/contained ValueSet concept lists are compared directly, so
  `cw-binding-superset` fails correctly while legitimate
  `cw-binding-subset` refinements pass. If expansion is not local and
  simple, the validator falls back to conservative URL inequality.
  Launch-discovery executed comparisons are now 100.0% pass rate
  (547/547) with 0 skips.

### Public API

- `recordsValidator.validate()` and the new `PublicFhirVersion` type
  now accept `'R4B'` alongside `'R4' | 'R5' | 'R6'`. R4B routes
  through the R4 internal path (same StructureDefinitions, same
  FHIRPath context) — this matches R4B's status as a maintenance
  release of R4. R4B-specific package bundling
  (`hl7.fhir.r4b.core`) is tracked under K-2.

### Terminology

- `TerminologyApiClient.subsumes()` is now process-cached with the
  same 15-minute TTL + 5000-entry LRU as `validateCode`. Successful
  outcomes (`subsumes` / `subsumed-by` / `equivalent` / `not-subsumed`)
  are cached; `'unknown'` (server error / malformed response) is
  intentionally not cached so a retry within the TTL can succeed.
  New `clearSubsumesCache()` and `getSubsumesCacheSize()` exports.
- New `TerminologyApiClient.isSubsumedBy(system, child, parent)`
  convenience helper. Returns `true` only when the parent strictly
  subsumes the child or is equivalent — the FHIR `$subsumes`
  argument order (codeA subsumes codeB) is easy to reverse and the
  named helper makes the intent at the call site obvious.

### Security

- New `checkFhirpathSandbox(expression, limits?)` static safety
  pre-flight for user-defined Custom Rules. fhirpath.js is
  synchronous and cannot be hard-timed out from the calling thread,
  so the only reliable defence against a pathological customer
  expression is to reject it before it runs. The sandbox enforces
  three bounds (default values shown):
    - `expressionLength`: 4096 characters
    - `functionCallCount`: 64
    - `nestingDepth`: 16
  String-literal aware: identifiers inside quoted spans don't count
  as function calls, so `matches('where(...)')` doesn't inflate
  metrics. Wired into `CustomRuleExecutor` in both the public
  package and the server-side mirror — rejected rules emit a
  `custom-rule-rejected-by-sandbox` warning issue with the measured
  metrics in `details.sandboxMetrics` so customers can tune.

### Fixes

- New `applyFixPatch(resource, patch)` helper for executing
  resolved `FixPatch` objects from the fix-suggestions catalog.
  Supports `add` / `replace` / `remove` actions on dotted paths with
  `[index]` array syntax, deep-clones the input (no mutation),
  rejects unresolved `{{templates}}`, coerces JSON-shaped string
  values into objects/arrays/numbers/booleans/null. Exported from
  the package root as `applyFixPatch`. Foundation for D-1 Auto-Fix
  Application — the catalog had 290 patches but no executor; this
  adds the executor.

## [0.1.0] — Initial public release

The first public release of the open-source FHIR validation engine
extracted from the Records DataOps Control Plane.

### Conformance

- 100.0% (493/493) JSON resource parity against the HL7 Java validator's
  `OperationOutcome` baseline on the executable comparison set.
- Discovery-lane backlog executed comparisons at 100.0% (547/547) with
  0 skips and 0 failures. Former measurable failures and skipped fixtures are
  explicit Java-baseline compatibility fixtures for authenticated Infoway
  terminology, Java-CLI harness behavior, FML/NDJSON parser baselines,
  JSON5 and DSIG JSON harness cases, hidden Java outcomes, a known Java
  choice-type bug, a missing upstream Java outcome artifact, and the future
  SDC package lane.
- MII KDS 2026 scoped reference parity 241/241 measured resources against the
  official MII validator container (`mii-2026-reference` scope), with 12
  classified corpus/profile-drift skips.

### Validator engine

- Pure TypeScript validator — no JVM, no database, no Records server
  modules. Validates parsed FHIR JSON resources against
  StructureDefinitions, FHIRPath constraints, terminology bindings,
  references, slicing, extensions, metadata, and Bundle reachability.
- FHIR R4, R5, and R6 supported. STU3/DSTU is out of scope.
- Optional `setProfileSource()`, `setCustomRulesSource()`, and
  `setEngineLogger()` hooks for embedders that want to provide
  database-backed profile resolution, custom business rules, or routed
  logging. No-op defaults make standalone use a single import.
- Two-phase terminology: ValueSets from installed IG packages are
  expanded at install time into a flat code set with O(1) lookup,
  falling back to a configured terminology server.
- Canonical pinning with deterministic IG version selection,
  transitive dependency tree-shaking, and `.records-lock.json` lock
  file generation.
- Advisor rules engine for post-validation severity overrides and
  message rewrites. Built-in rule sets ship and self-scope:
  - Canonical-URL sanity (SNOMED `srt` typo, LOINC `https` typo,
    trailing-slash variants, etc.) — match by message substring.
  - MII KDS 2026 starter rules (NUM-CODEX secondary coding,
    Patientennummer assigner/system, Fall-Kontakt slicing,
    Medikation reference) — match by profile prefix.
- Recursive unknown-property walker descends into BackboneElement
  children and complex datatypes via lazy SD loading; expands choice
  types; skips `Resource` / `DomainResource` to keep noise out.
- `compliesWithProfile` derived-StructureDefinition compliance check
  with cardinality, missing-constraint, weakened-binding, slicing rule,
  and pattern/fixed conflict diagnostics.

### Distribution

- npm publish workflow at `validator-v*` GitHub release tags
  (`publish-validator.yml`) publishes `@records-fhir/validation-types` before
  `@records-fhir/validator`.
- Composite GitHub Action `medvertical/records-fhir-validator@v1`
  (`packages/validator/action.yml`) with inputs `paths`,
  `profile-url`, `fhir-version`, `fail-on`, `output-file`,
  `validator-version`, `log-level`. Outputs
  `issue-count` / `error-count` / `warning-count`.
- Action defaults to `log-level: warn` for clean CI annotations;
  raise to `info` or `debug` to see engine traces.

### Reproducibility

- `VALIDATION_ENGINE_VERSION` is env-gated: defaults to a stable cache
  key, derives `<pkg>+<gitsha>` when `ENGINE_VERSION_FROM_BUILD=true`
  for regulatory-mode runs.
- Evidence reports embed a SHA-256 `report_content_hash` over the
  payload via `EvidenceReportService.finalizeReportContent`.

### Internal fixes worth calling out

- fhirpath.js compiled-function `traceFn` was passed in the wrong
  argument position, causing `TRACE:[unmatched] []` lines to appear
  in CI output for any constraint that called `.trace()`. Moved to
  the third arg (additional options) where fhirpath actually reads
  it. Affects both the public package and the server-side mirror.

### Known limitations

- No CQL evaluator (the upstream `cql-evaluator` is not ported);
  `measure` module ceiling is around 60%.
- fhirpath.js R5-boundary functions (`lowBoundary`, `highBoundary`,
  `aggregate`) are not implemented upstream and cap a handful of
  R5/R6 tests.
- XML, Turtle, CDA, HL7 v2, NDJSON, FML, CDS Hooks, SHC, and DSIG
  are explicitly out of scope for this package and are not blended
  into the headline conformance score.

[Unreleased]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.1.0...HEAD
[0.1.0]: https://github.com/medvertical/records-fhir-validator/releases/tag/validator-v0.1.0
