# Contributing to `@records-fhir/validator`

Thanks for taking an interest. This document covers what's in scope for the
public validator engine, what isn't, and the mechanics of getting a change
landed.

## What this package is

A pure-TypeScript FHIR R4/R5/R6 validator. No JVM, no database, no Records
server modules. The canonical home is the public repo
[`medvertical/records-fhir-validator`](https://github.com/medvertical/records-fhir-validator);
the Records DataOps Control Plane (the surrounding commercial product) lives
elsewhere and is not part of this package.

In scope for contributions:

- Validator engine fixes (StructureDefinition, FHIRPath constraints,
  terminology, references, slicing, extensions, metadata, Bundle).
- Conformance work — closing remaining HL7 fhir-test-cases parity fails or
  expanding the executable comparison set into NDJSON/FML/XML lanes.
- Performance and cache improvements.
- Bundled rule sets that are scope-disciplined (canonical-URL sanity,
  MII KDS, future IG-specific guidance).
- Documentation, examples, embedder integration hooks.

Out of scope:

- The Records web application, API routes, database schema, evidence
  reports, customer integrations, or any commercial workflow code.
- New aspect categories that change the engine's contract — open a
  discussion before writing code.
- Adding adjacent standards (CDA, HL7 v2, CDS Hooks, SHC, DSIG) — these
  belong in dedicated modules with their own conformance lanes.
- Forking the FHIRPath engine. We use `fhirpath.js` and contribute
  upstream when the gap warrants it; full rewrites are not on the
  roadmap.

## Reporting issues

For bugs:

1. Confirm the resource validates the way you expect against the HL7 Java
   validator if possible, and include both `OperationOutcome`s in the bug
   report.
2. Include the exact validator version (`@records-fhir/validator`'s
   `package.json` version + the `VALIDATION_ENGINE_VERSION` if you set
   `ENGINE_VERSION_FROM_BUILD=true`).
3. Include FHIR version (R4 / R5 / R6), the profile URL the resource was
   validated against, and the IG package set (lockfile if available).
4. A minimal reproducer is a single resource JSON + a single profile
   declaration. Avoid posting whole datasets — metadata + hashes only,
   not clinical payloads.

For security issues, do **not** open a public issue. See `SECURITY.md` (or
email security@medvertical.com if no policy file is present).

## Pull requests

Branch naming: `claude/<short-description>` or `cursor/<desc>` is fine for
AI-assisted work; otherwise a topic-style branch (`fix-slicing-edge-case`,
`feat-r6-boundary-functions`).

**Every PR must include:**

- A test that exercises the change. For engine fixes, add a unit test in
  the relevant validator's `__tests__/` folder. For parity fixes, run
  `npm run conformance -- --skip-download` and update the result artifact
  in `conformance-results/` with the measured delta.
- Changelog entry under the `[Unreleased]` section in `CHANGELOG.md`.
- Description that includes the conformance-run delta if the PR touches a
  validator path. Format: `JSON parity: 496/496 → 497/497` or
  `discovery lane executed comparisons: 546/547 → 547/547`.

**What CI runs:**

- ESLint with `--max-warnings=0`.
- Vitest unit tests across all workspaces.
- `tsc --noEmit` on the validator package.
- `npm pack --dry-run` smoke test.
- For PRs that touch validation engine code: `npm run conformance:affected`
  with `TX_SERVER=https://tx-dev.fhir.org/r4`.

Pre-commit hooks run lint-staged with zero warnings, a barrel-export
guard, and the circular-dependency check (`npm run deps:check`). Don't
disable them — fix the underlying issue.

## Conformance discipline

The headline conformance number (496/496 JSON resource parity against the
Java validator) is the package's externally-visible quality claim.
Treat it like a public API:

- Don't merge a PR that drops the headline score without a written
  rationale and an acknowledged baseline update.
- Use `npm run quality:regression-check` to verify against
  `conformance-results/baseline-passing.json` before opening the PR.
- For new test cases that newly pass, run
  `npm run conformance:refresh-baseline -- --report <run>.json` and
  commit the baseline delta in the same PR.

## Coding conventions

- File size limits: `max-lines: 400`, `max-lines-per-function: 80`.
  Don't add new `eslint-disable` comments without a one-line justification.
- TypeScript over classes for new code; classes are fine where they
  already exist (validators, services).
- Comments document **why**, not **what**. Well-named identifiers carry
  the "what". Don't narrate PR / bug context in source.
- Tests colocated in `__tests__/` next to the code or as `*.test.ts`
  siblings.
- No clinical payloads in tests — use synthetic fixtures or hashed
  references.

## Licence

Contributions are accepted under the package's Apache-2.0 licence. By
opening a pull request you confirm you have the right to license the
contribution under those terms.

## Questions

Open a GitHub issue with the `question` label, or — if the question is
about how the records engine behaves vs. the Java validator — open a
parity comparison issue with both `OperationOutcome`s attached.
