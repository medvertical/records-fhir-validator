# Changelog

All notable changes to `@records-fhir/validation-types` are documented
in this file. Format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package ships in lockstep with `@records-fhir/validator`; cross-
package changes are noted in that package's CHANGELOG. This file
captures changes that affect type-package consumers directly.

## [Unreleased]

## [0.1.12] — 2026-09-22

### Changed

- Build with native NodeNext resolution and explicit ESM import specifiers.
  Public runtime and declaration exports load without a post-build rewrite;
  all seven entrypoints remain compatible with Node and TypeScript consumers.

## [0.1.10] — 2026-09-01

Compatibility hotfix for consumers of `@records-fhir/validator` 0.6.2.

### Fixed

- Exported `./validation/structural-engines` as an explicit ESM and type
  subpath so packaged Node.js consumers can resolve the structural-engine
  runtime contract.

## [0.1.9] — 2026-08-25

Released alongside `@records-fhir/validator` 0.6.2.

### Surface

- Added optional `TerminologyServer.snomedEditions` module identifiers to the
  public settings type and Zod schema. The default SNOMED server advertises the
  International Edition module (`900000000000207008`), allowing consumers to
  configure deterministic national-edition routing without a breaking settings
  migration.

## [0.1.8] — 2026-08-24

Released alongside `@records-fhir/validator` 0.6.1.

### Surface

- `string-whitespace-padding` no longer carries a patch template. The
  trimmed value is deliberately absent from validator 0.6.1's issue
  details — a padded `Patient.name.family` is clinical content — so the
  template could no longer resolve, and `resolvePatch` returned `null`
  for it. Removing it makes the catalog say what the validator does.
  Consumers that read `suggestion.patch` directly should treat its
  absence as "trim locally"; the `fix` and `example` text is unchanged.

## [0.1.7] — 2026-08-19

Released alongside `@records-fhir/validator` 0.6.0. Documented
retroactively — the version shipped without an entry here.

### Surface

- Added fix-suggestion catalog entries for the checks introduced in
  validator 0.6.0: `attachment-att1-violation`, `attachment-no-content`,
  `narrative-txt2-violation`, `date-year-implausible`,
  `string-whitespace-padding`, `decimal-value-out-of-range`, and
  `language-code-invalid`.

## [0.1.6] — 2026-07-23

Released alongside `@records-fhir/validator` 0.5.0.

### Surface

- Added `code-inferred` to `ProfileApplicationSource` so consumers can
  distinguish FHIR-implied Observation profile selection from explicit,
  resource-declared, imposed-policy, and base-fallback application.

## [0.1.5] — 2026-06-23

Released alongside `@records-fhir/validator` 0.1.14.

### Surface

- Published the issue-identity helper exports, including
  `computeValidationIssueId`, required by the validator runtime and CLI.

## [0.1.4] — 2026-05-28

Released alongside `@records-fhir/validator` 0.1.10.

### Surface

- Normalized profile source settings and defaults used by the validator runtime
  and UI settings snapshots.
- Kept the current EPS preview package visible in the default package source
  set while preserving the canonical xTeHR reference.
- Updated schema coverage so downstream consumers can validate the same
  settings shape used by the restored HL7 and MII parity gates.

## [0.1.3] — 2026-05-26

Released alongside `@records-fhir/validator` 0.1.9.

### Fixes

- Added explicit package exports for `/fix-suggestions` and selected
  `/validation/*` subpaths so downstream package builds can resolve the
  documented public type entry points.

## [0.1.2] — 2026-05-18

Released alongside `@records-fhir/validator` 0.1.7.

### Surface

- Added optional `performance.enableDeltaSearch` to `ValidationSettings`.
- Included `enableDeltaSearch: true` in the R4/R5 default validation settings
  and the default performance settings helper.
- Extended the Zod validation settings schema to accept
  `performance.enableDeltaSearch`.

## [0.1.1] — 2026-05-04

Released alongside `@records-fhir/validator` 0.1.2. Not yet published
to npm pending the license decision.

### Deprecations

- The legacy `validation-settings.ts` facade is now annotated
  `@deprecated`. IDEs and TypeScript will surface the deprecation
  on import. The canonical entry points are
  `@records-fhir/validation-types` (root) and the explicit subpaths
  (`/validation-settings`, `/fix-suggestions`, `/validation/aspect-enums`,
  etc.). The facade re-exports the same types and will be removed in
  a future major version.

### Surface

- All exports remain stable. Subpath exports are listed in
  `package.json#exports`; deep imports outside that allow-list are
  considered internal and may move without notice.

## [0.1.0] — Initial public release

First public release. Pure-types boundary for the
`@records-fhir/validator` runtime — no runtime code, no DB coupling.
Ships:

- `ValidationIssue`, `ValidationResult`, `ValidationSettings`
- Aspect / severity / strictness enums
- `AdvisorRule`, `AdvisorRuleMatch`, `AdvisorRuleTransform`
- `FixSuggestion`, `FixPatch` and the catalog
- DTOs for run/baseline/delta/release/dataset evidence reports
- `MII_2026_PACKAGE_SET` and the MII terminology-mode enum
