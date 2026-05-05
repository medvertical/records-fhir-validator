# Changelog

All notable changes to `@records-fhir/validation-types` are documented
in this file. Format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package ships in lockstep with `@records-fhir/validator`; cross-
package changes are noted in that package's CHANGELOG. This file
captures changes that affect type-package consumers directly.

## [Unreleased]

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
