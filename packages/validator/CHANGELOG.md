# Changelog

All notable changes to `@records-fhir/validator` are documented in this
file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The companion `@records-fhir/validation-types` and
`@records-fhir/bundled-profiles` packages share this changelog when they
ship together; package-only changes are noted under each release.

## [Unreleased]

No unreleased changes yet.

## [0.4.1] — 2026-07-01

Patch release for the standalone validator evidence lanes and MII reference
workflow. Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added validator claim summary generation for publishing the current HL7,
  MII reference, and FHIR Schema dual-path evidence in one machine-readable
  artifact.
- Added FHIR Schema dual-path action reporting so unconfirmed graph/reference
  buckets remain explicit follow-up work instead of hidden parity debt.
- Added package-backed terminology diagnostics and local terminology server
  helpers for deterministic MII/FHIR Schema quality lanes.

### Changed

- Hardened the MII reference triangulation workflow with reference-health
  probes, policy-rule extraction, skip taxonomy, and failed-profile prewarm
  details.
- Refreshed the public validator documentation around the 2026-07-01 evidence:
  496/496 HL7 executable JSON comparisons, 231/231 measured MII reference
  parity, and 555-fixture FHIR Schema dual-path coverage.
- Tightened FHIR Schema graph slicing, reference-target extraction, and pattern
  diagnostics while keeping the graph path in parallel evidence mode.

### Fixed

- Fixed MII package relevance detection so package names containing substrings
  such as `isik` are not misclassified as Gematik ISiK packages.
- Fixed nested profile slice scoping and choice/FHIRPath edge cases uncovered
  by the MII and FHIR Schema dual-path lanes.

### Verification

- Verified with repository lint, stable tests, targeted validator Vitest
  suites, full affected conformance, MII reference gate, HL7 parity gate, and
  FHIR Schema dual-path report generation.

## [0.4.0] — 2026-06-30

Runtime slicing and evidence-gate update for the standalone validator and
GitHub Action. Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added runtime support for differential-only slices that inherit slicing from
  their base or snapshot when slice elements do not redeclare slicing locally.
- Added local-first FHIR Schema dual-path evidence reporting with exported
  normalization helpers for comparing Records, graph-derived validation, and
  Java OperationOutcome baselines.
- Added focused regression coverage for required slices, closed slicing,
  `memberOf` prechecks, and FHIR Schema StructureDefinition merge behavior.

### Changed

- Merge differential and base StructureDefinition elements by slice-aware
  identity instead of path alone, keeping same-path slices from sharing
  cardinality or metadata by accident.
- Normalize known equivalent closed-slicing diagnostics in the evidence lane so
  Java pattern differences are measured without hiding real parity gaps.
- Refresh README evidence around the current MII/ISiK triangulation signal and
  scoped FHIR Schema dual-path status.

### Fixed

- Fixed required-slice detection for profiled differential-only slices where
  the slice exists in the differential but the slicing declaration is inherited.
- Fixed local terminology/memberOf precheck diagnostics so missing local
  expansions produce stable validation signals without depending on remote TX
  availability.

### Verification

- Verified locally with validator typecheck/build, targeted Vitest suites, MII
  reference gate, validator performance gate, and repository lint.

## [0.3.0] — 2026-06-23

Release-hardening update for the standalone validator and GitHub Action.
Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added `recordsValidator.validateAll(...)`, an ordered public batch API that
  returns `index`, `resourceType`, `id`, `isValid`, and `issues` for each input
  while still using the optimized batch path for homogeneous profile/settings.
- Added stable issue-contract helpers:
  `issueFingerprint`, `summarizeIssueFingerprints`, `stableIssues`,
  `issueMatchesAnchor`, and `issuePathMatchesPattern`.
- Added structured terminology diagnostics in `ValueSetValidator.getCacheStats()`
  for unverified bindings and fail-open membership checks.
- Added cold-start, warmup, measured-wall-clock, heap, and peak-RSS fields to
  the local validator performance baseline.
- Added a pinned `FHIR/fhir-test-cases` runner default at
  `431b37cd06cac878bc23b4a8b457c2f2397fdcdc` with an override flag/env var for
  intentional upstream refreshes.

### Changed

- Negative-cache failed FHIRPath constraint-expression compiles so repeated
  unsupported expressions do not pay repeated compile cost.
- Silence HL7 conformance-runner engine logs by default while keeping a
  `--verbose` escape hatch for investigation.
- Refresh README/public-mirror conformance evidence around the pinned
  2026-06-23 local run: 496/496 executable comparisons passed, 40 Java-baseline
  output skips, and 100.0% headline JSON-resource parity.

### Fixed

- Exclude the selected `--output` report path from CLI validation inputs so a
  later folder run does not validate its own previous report.

### Verification

- Verified locally with validator typecheck/build, targeted Vitest suites,
  mirror-import guard, OSS package smoke test, local performance baseline, and
  full pinned conformance against `FHIR/fhir-test-cases`.

## [0.2.0] — 2026-06-23

Production-readiness release for the standalone npm CLI. Released with
`@records-fhir/validation-types` 0.1.5.

### Added

- Added `--output <file>` so CLI runs can write JSON or text reports without
  shell redirection.
- Added `--summary-only` for quiet CI jobs that only need aggregate counts.
- Added repeatable `--include <glob>` and `--exclude <glob>` filters for
  folder validation.
- Documented stable CLI exit codes: `0` for pass, `1` for validation threshold
  failure, `2` for usage/input/output errors.
- Added direct CLI behavior coverage for report output, summary-only mode,
  include/exclude filters, help text, and usage/output error exit code `2`.
- Added a deterministic golden quality-corpus matrix that validates
  representative R4 defect fixtures against `.expected.json` issue anchors
  without reading the developer's global FHIR package cache.
- Added a local validator performance-baseline command with fixture limiting
  and optional mean/p95/p99/worst timing budgets:
  `npm run quality:validator-perf-baseline`.

### Verification

- Extended the OSS package smoke test to install the packed npm package in a
  fresh project and execute the installed `records-fhir-validator` binary with
  output-file, summary-only, include, and exclude options.
- Verified the local release loop with targeted Vitest suites, package
  typecheck/build, mirror-import guard, OSS package smoke test, and the local
  performance baseline.

### Changed

- Typed the public `recordsValidator` singleton facade so public API calls stay
  aligned with the underlying `RecordsValidator` engine signatures.
- Split the CLI implementation into argument parsing, file matching, validation
  execution, shared result types, and output rendering.
- Extracted reusable issue-contract anchors for stable golden-corpus
  assertions.
- Isolated the slicing ValueSet package loader so discriminator binding lookups
  use a private terminology cache and preserve `FHIR_PACKAGE_CACHE_PATH` even
  when dotenv leaves a literal `$HOME` placeholder.
- Tightened CLI JSON-input and issue-rendering types from loose `any` handling
  to guarded `unknown` boundaries.

## [0.1.14] — 2026-06-23

Runtime patch release for the standalone CLI package. Released with
`@records-fhir/validation-types` 0.1.5.

### Fixes

- Pinned the validator runtime dependency to `@records-fhir/validation-types`
  0.1.5 so npm installs include the issue-identity helper exports required by
  the CLI and validation engine.

## [0.1.13] — 2026-06-23

Public usability polish for the standalone validator package and public mirror.
Released with `@records-fhir/validation-types` 0.1.4.

### Added

- Added the `records-fhir-validator` npm binary for local file/folder
  validation, JSON output, FHIR version selection, profile-url selection, and
  configurable CI failure thresholds.

### Documentation

- Reworked the package README and public mirror README around copy-pasteable
  CLI, TypeScript API, and GitHub Action quickstarts.
- Documented structured issue output and clarified the current practical scope
  of the TypeScript validator before broader conformance evidence.
- Updated examples and security docs from the old `@v1` action reference to
  the current `@v0` / `@v0.1.13` release line.

## [0.1.12] — 2026-06-23

Feature release adding FHIR R6 validation. Released with
`@records-fhir/validation-types` 0.1.4. Re-verified green against the HL7
`fhir-test-cases` JSON-resource parity gate.

### Features

- **FHIR R6 validation support** — resources can now be validated against R6
  alongside R4, R4B, and R5.
- **Publication-status escalation** in the strictness layer: issue severity now
  accounts for the publication status of the governing artifact.

### Fixes

- `memberOf()` boolean constraints: added a synchronous fallback so terminology
  `memberOf` checks resolve correctly when async ValueSet expansion is
  unavailable.
- Reduced validation false positives and corrected gate-status reporting.
- Hardened engine contracts and expanded golden-regression coverage.

### Maintenance

- Split `valueset-validator` into cohesive modules (binding, code-system,
  expansion-loader, filter-checks, two-phase-shadow).
- Deduped advisor rules into the validator package; split out the terminology
  server manager.
- Extracted the SD-loader profile-load pipeline, extension FHIR-version filter,
  circular-reference graph builder, and profile→package detection.

## [0.1.11] — 2026-06-01

Patch release for the standalone OSS validator package after the latest Firely
and public-server validation runs. Released with
`@records-fhir/validation-types` 0.1.4.

### Fixes

- Closed the remaining HL7/HAPI validator-CLI capability gaps around profile
  fallback, bundle-entry validation, and multi-aspect strictness handling.
- Preserved code-aware display equivalence checks by passing the full code
  context into display normalization.
- Kept the EHDS EPS package selection stable while retaining the pinned
  transitive reference closure.

### Maintenance

- Refreshed direct runtime dependencies: `axios`, `date-fns`, `fhirpath`, and
  `tar`.
- Verified the package boundary, TypeScript build, and OSS smoke checks before
  publishing.

## [0.1.10] — 2026-05-28

Patch release after the HL7 JSON and MII 2026 parity gates were restored to
100% on the current reference suites. Released with
`@records-fhir/validation-types` 0.1.4.

### Fixes

- Normalized profile source settings so the package engine, server runtime,
  Simplifier/registry loading, and bundled package fallback use the same source
  policy.
- Kept the current EPS preview package pinned while preserving the canonical
  xTeHR reference source, avoiding accidental drift when upstream preview
  packages move.
- Tightened advisor, metadata, reference, strictness, and batch validation code
  paths around the shared runtime settings model.

### Quality

- Restored full HL7 JSON conformance parity against the current
  `fhir-test-cases` checkout: 496/496 run cases pass.
- Restored MII 2026 reference parity against the current MII validator
  container: 241/241 measured cases pass.
- Added CI guardrails so missing bundled FHIR core profiles fail early instead
  of surfacing as broad false parity regressions.

## [0.1.9] — 2026-05-26

Patch release focused on reducing profile/slicing false positives found in
large Firely/ART-DECOR validation runs. Released with
`@records-fhir/validation-types` 0.1.3.

### Fixes

- Preserved inherited slice cardinality correctly when generating snapshots
  from differential-only profiles. This fixes false
  `profile-slice-min-cardinality` errors where a base element minimum leaked
  into an inherited named slice such as `Observation.code.coding:IEEE-11073`.
- Scoped nested extension slice validation so child extension rules only apply
  to the matching parent extension slice.
- Ignored extension slices whose type profiles target another FHIR version,
  avoiding R5 extension requirements during R4 validation.
- Deduplicated profiled extension cardinality and coding-system/value-set
  diagnostics so equivalent constraints do not produce repeated issue rows.
- Improved package detection for Da Vinci Plan-Net, US, UK, AU, Dutch, IHE,
  and universal realm IGs used by large public FHIR servers.

### Quality

- Added regression coverage for inherited slice cardinality during snapshot
  generation and the affected nested/profiled slicing cases.
- Refactored public validator imports and strictness filtering to reduce
  package/server drift without changing the public API.

## [0.1.8] — 2026-05-25

Patch release focused on validation precision and EHDS/large-server readiness.
Released with `@records-fhir/validation-types` 0.1.2.

### Fixes

- Reduced false positives in anomaly, reference, MustSupport, duplicate-event,
  temporal-gap, and clinical coding checks across large FHIR servers.
- Improved terminology behavior for SNOMED, UCUM, display variants, unsupported
  ValueSet filters, inactive-code disagreements, nested ValueSets, and
  CodeableConcept arrays.
- Kept display mismatches and profile-fixed binding diagnostics from becoming
  noisy hard failures when terminology servers disagree or omit optional
  metadata.
- Hardened package/profile resolution around cached package scans, Simplifier
  metadata, Ontoserver responses, and ART-DECOR/HAPI comparison inputs.

### Quality

- Added regression coverage for terminology display variants, inactive fallback
  behavior, duplicate diagnostic reports, value range units, and contextual
  MustSupport skips.
- Reworked validation internals toward explicit resource, issue, pipeline, and
  terminology payload types so the package/server mirror has fewer broad casts
  and less drift risk.

## [0.1.7] — 2026-05-18

Patch release for eHDS document-Bundle conformance and public-package
hardening. Released with `@records-fhir/validation-types` 0.1.2.

### Fixes

- Added document-context validation for eHDS/EPS-style Bundles so Composition
  section entries are checked against their section `targetProfile` contracts.
- Added conformance-aware Bundle entry slice matching, including
  `structuredefinition-imposeProfile` support, so imposed IPS/EPS Composition
  profile requirements produce the same parent-profile and slice-min
  consequences observed in the reference HAPI/MII validator.
- Shared document-context validation between single-resource and multi-aspect
  validator paths to keep package and server behavior aligned.
- Fixed invariant execution context ownership in the package engine and removed
  stale server-side mirror paths that could drift from the OSS validator.

### Terminology and packages

- Hardened terminology/package loading around package download retries,
  filesystem StructureDefinition loading, ValueSet cache behavior, and UCUM
  canonical unit handling.
- Added public validation settings support for `performance.enableDeltaSearch`
  through `@records-fhir/validation-types` 0.1.2.

### Tests

- Added regression coverage for multi-aspect Bundle entry validation,
  document-context targetProfile narrowing, imposed-profile slice consequences,
  SD FHIRPath choice types, slice discriminator matching, package downloads,
  and ART-DECOR document parent parity.
- Added ART-DECOR/HAPI smoke commands and an `ehds-strict` policy gate used to
  keep Records-vs-HAPI semantic deltas actionable.

## [0.1.5] — 2026-05-09

Patch release for terminology slice parity and refreshed conformance evidence.

### Fixes

- Fixed required-binding false positives for missing optional slice roots. The
  terminology executor now leaves absent optional slices to slicing/cardinality
  validation instead of emitting broad `binding-required-missing` diagnostics.
- Fixed slice-descendant binding validation for FHIR choice-type paths such as
  `Observation.component.value[x]`; matching slice values now resolve concrete
  instance keys such as `valueCodeableConcept`.
- Kept the server-side Records validator mirror in sync with the standalone
  package executor.

### Tests

- Added regression coverage for sliced `Observation.component.value[x]`
  bindings using `valueCodeableConcept`.
- Refreshed HL7 `FHIR/fhir-test-cases` evidence: 496/496 executable JSON
  comparisons passed with 35 Java-baseline backlog skips at upstream commit
  `e543043a076c493656fc8008df250659b15d02cb`.
- Refreshed scoped MII 2026 reference parity against the official MII validator
  container: 241/241 measured resources passed, 12 classified corpus/profile
  skips, parity score 100.0%.

## [0.1.4] — 2026-05-06

Patch release for the Firely validation triage and public package
sync.

### Fixes

- Fixed false positives in slice matching for `$this` Coding slices and
  slice child constraints.
- Hardened StructureDefinition loading so R4/R5 core definitions and
  cached package scans do not cross-contaminate validation runs.
- Tightened unknown-property detection so internal enhancer fields and
  valid primitive companion fields are not reported as structural
  errors.
- Improved terminology parity: display comparisons now ignore
  case/whitespace-only differences, missing CodeSystem values are
  warnings, and unvalidated terminology coverage uses stable issue
  codes.
- Improved reference parsing for contained references, absolute URLs,
  versioned references, and Bundle entry contexts.

### Tests

- Added focused regression coverage for StructureDefinition cache
  versioning, unknown-property walking, slice element matching,
  terminology issue classification, and reference format/type
  extraction.

## [0.1.3] — 2026-05-05

Patch release fixing a public-export gap that shipped in 0.1.2. No
behaviour or API changes beyond the missing re-exports being
restored.

### Fixes

- Re-export `applyFixPatch` + `FixApplyResult`, `checkFhirpathSandbox`
  + `SandboxLimits` + `SandboxResult`, and the fix-suggestions
  catalog (`FixSuggestions`, `getFixSuggestion`, `formatFixSuggestion`,
  `createValidationIssue`, `CreateIssueParams`) from the package
  root. In 0.1.2 they existed in subpath barrels only; the
  CHANGELOG and concept docs advertised them as top-level exports
  but a fresh `npm install` of 0.1.2 threw
  `SyntaxError: does not provide an export named 'applyFixPatch'`
  when consumers followed the docs. Caught by an out-of-tree
  smoke test against the packed tarballs after publication.

  Verified against the published tarball: the named exports
  `applyFixPatch`, `checkFhirpathSandbox`, and `getFixSuggestion`
  are present at the package root in 0.1.3.

### Migration from 0.1.2

If you worked around the missing exports with subpath imports:

```ts
import { applyFixPatch } from '@records-fhir/validator/issues';
import { checkFhirpathSandbox } from '@records-fhir/validator/validators/fhirpath-sandbox';
```

…you can switch to the documented top-level form:

```ts
import { applyFixPatch, checkFhirpathSandbox } from '@records-fhir/validator';
```

Both forms continue to work; the subpath imports stay supported.

## [0.1.2] — 2026-05-04

Coordinated release with `@records-fhir/validation-types` 0.1.1.
Bundles the entire 2026-05-03 sprint plus the OSS boundary cleanup,
business-rules subpath exports, and the validator engine extractions
that landed before the bump. Not yet published to npm pending the
license decision (see the `oss-launch-checklist.md` in the source
repo).

### Engine

- `compliesWithProfile` now checks `required`/`extensible` binding
  ValueSet compatibility for `cw-binding-*` fixtures. Simple
  inline/contained ValueSet concept lists are compared directly, so
  `cw-binding-superset` fails correctly while legitimate
  `cw-binding-subset` refinements pass. Falls back to conservative
  URL inequality when expansion is not local and simple.
  Launch-discovery executed comparisons reach 100.0% pass rate
  (547/547) with 0 skips.

### Public API

- `recordsValidator.validate()` and the new `PublicFhirVersion` type
  accept `'R4B'` alongside `'R4' | 'R5' | 'R6'`. R4B routes through
  the R4 internal path (same StructureDefinitions, same FHIRPath
  context) — this matches R4B's status as a maintenance release of
  R4. R4B-specific package bundling (`hl7.fhir.r4b.core`) is tracked
  under K-2.
- `toInternalFhirVersion(v: PublicFhirVersion)` exported for
  embedders that need to route their own internal calls.

### Terminology

- `TerminologyApiClient.subsumes()` is now process-cached with the
  same 15-minute TTL + 5000-entry LRU as `validateCode`. Successful
  outcomes (`subsumes` / `subsumed-by` / `equivalent` / `not-subsumed`)
  are cached; `'unknown'` (server error / malformed response) is
  intentionally not cached so a retry within the TTL can succeed.
  New `clearSubsumesCache()` and `getSubsumesCacheSize()` exports.
- `TerminologyApiClient.isSubsumedBy(system, child, parent)`
  convenience helper. Returns `true` only when the parent strictly
  subsumes the child or is equivalent — the FHIR `$subsumes` argument
  order (codeA subsumes codeB) is easy to reverse and the named
  helper makes the intent at the call site obvious.

### Security

- `checkFhirpathSandbox(expression, limits?)` — static safety
  pre-flight for user-defined Custom Rules. fhirpath.js is
  synchronous and cannot be hard-timed out from the calling thread,
  so the only reliable defence against a pathological customer
  expression is to reject it before it runs. Three bounds:
    - `expressionLength`: 4096 characters
    - `functionCallCount`: 64
    - `nestingDepth`: 16
  String-literal aware: identifiers inside quoted spans don't count
  as function calls. Wired into `CustomRuleExecutor`; rejected rules
  emit a `custom-rule-rejected-by-sandbox` warning with the measured
  metrics in `details.sandboxMetrics`.

### Fixes

- `applyFixPatch(resource, patch)` executor for resolved `FixPatch`
  objects from the fix-suggestions catalog. Supports
  `add` / `replace` / `remove` on dotted paths with `[index]` array
  syntax, deep-clones the input, rejects unresolved `{{templates}}`,
  coerces JSON-shaped string values into objects/arrays/numbers/
  booleans/null.
- Fixed: fhirpath.js compiled-function `traceFn` was being passed in
  the wrong arg position (envVars instead of additionalOptions),
  causing `TRACE:[unmatched] []` lines to appear in CI output for
  any constraint that called `.trace()`. Moved to the third arg.

### Subpath exports (OSS extraction)

- `@records-fhir/validator/business-rules` — built-in business rule
  registry + element-path resolver, extracted from the server.
- `@records-fhir/validator/business-rules/rule-registry` — direct
  access to the rule registry for callers that wire their own
  catalogs.
- StructureDefinition → FHIRSchema converter prototype moved into
  the OSS validator surface.

### Boundary

- Dropped `node-fetch` runtime dep; uses platform `fetch`.
- New `FHIR_BUNDLED_PROFILES_PATH` env var so embedders can point at
  any local `~/.fhir/packages`-shaped directory tree.

### Distribution / day-1 OSS material

- `examples/` directory ships in the tarball (`standalone-validate.mjs`,
  `bulk-folder-validate.mjs`, `github-workflow.yml`, `README.md`).
- `CHANGELOG.md` and `CONTRIBUTING.md` ship in the tarball.
- `log-level` input on the composite GitHub Action with `warn`
  default — CI output for a typical run drops from ~47 to ~9 lines
  per file (100% signal).

### Internal — Records platform

- MII KDS 2026 advisor-rule starter set (`mii-kds.yaml` + TS mirror)
  plus a generic `AdvisorRuleSet` YAML loader.
- `getActiveAdvisorRules()` merges built-ins (canonical-URL sanity,
  MII KDS) with DB-managed customer rules deterministically.
- `mii-2026.records-lock.json` now contains transitive canonical
  pinning (was package-list only) when MII packages are resolvable
  on disk.
- `POST /api/validation/validateResource` MII-validator-compatible
  shim.
- Dataset Quality Reports gain per-resource-type issue rates
  (`resourceTypeIssueRates` field).
- HAPI Hybrid Bridge deployment guide (`docs/operations/`).

## [0.1.1] — Skipped

Bumped in `package.json` for the boundary cleanup landed in #104 but
never published to npm. Superseded by 0.1.2.

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

[Unreleased]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.0...HEAD
[0.4.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.3.0...validator-v0.4.0
[0.3.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.2.0...validator-v0.3.0
[0.2.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.1.14...validator-v0.2.0
[0.1.0]: https://github.com/medvertical/records-fhir-validator/releases/tag/validator-v0.1.0
