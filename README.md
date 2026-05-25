
# Records FHIR Validator

Pure TypeScript FHIR validator for CI pipelines, GitHub Actions, and
standalone Node.js use. It validates FHIR JSON resources against
StructureDefinitions, FHIRPath invariants, terminology bindings, references,
slicing, extensions, Bundle rules, metadata, and optional custom rules without
requiring a JVM, database, or Records server.

[![npm](https://img.shields.io/npm/v/@records-fhir/validator)](https://www.npmjs.com/package/@records-fhir/validator)
[![FHIR](https://img.shields.io/badge/FHIR-R4%20%7C%20R4B%20%7C%20R5%20%7C%20R6-blue)](#fhir-version-support)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![HL7 parity](https://img.shields.io/badge/HL7%20JSON%20parity-496%2F496-brightgreen)](#validation-evidence)
[![MII scope](https://img.shields.io/badge/MII%202026%20scope-241%2F241-brightgreen)](#mii-2026-reference-scope)

## Quick Start

### GitHub Action

Use the floating major tag for the latest stable validator in the current
major line:

```yaml
name: Validate FHIR

on:
  pull_request:
  push:
    branches: [main]

jobs:
  fhir:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: medvertical/records-fhir-validator@v0
        with:
          paths: |
            examples/**/*.json
            test/fixtures/**/*.json
          fhir-version: R4
          fail-on: error
```

For production CI, pin an immutable patch tag:

```yaml
- uses: medvertical/records-fhir-validator@v0.1.8
  with:
    paths: resources/**/*.json
    profile-url: http://hl7.org/fhir/StructureDefinition/Patient
    fhir-version: R4
    fail-on: error
```

Action pinning:

| Goal | Pin in `uses:` | Notes |
|---|---|---|
| Latest stable in current major | `medvertical/records-fhir-validator@v0` | Floating tag, force-moved on stable releases only |
| Exact released version | `medvertical/records-fhir-validator@v0.1.8` | Immutable consumer tag |
| Bit-exact reproducibility | `medvertical/records-fhir-validator@<commit-sha>` | Best for audit and forensics |

The `validator-v<semver>` tag is the npm mirror/release-page tag. Use
`v<semver>` or a commit SHA for GitHub Action pins.

### npm Package

```sh
npm install @records-fhir/validator@0.1.8 @records-fhir/validation-types@0.1.2
```

Validate a resource from Node.js:

```ts
import { recordsValidator } from '@records-fhir/validator';

const issues = await recordsValidator.validate(
  { resourceType: 'Patient', id: 'example' },
  'http://hl7.org/fhir/StructureDefinition/Patient',
  'R4',
);
```

Optional offline profile packages can be loaded through the package APIs. The
default public repository export intentionally excludes bundled third-party IG
artifacts until their upstream licenses and notices have been reviewed.

## What Is Included

- `@records-fhir/validator` 0.1.8 - Apache-2.0 validation engine.
- `@records-fhir/validation-types` 0.1.2 - Apache-2.0 validation-domain types.
- Composite GitHub Action at repository root.
- Standalone examples under `packages/validator/examples/`.
- Boundary audit and smoke-test scripts.
- Public conformance evidence artifacts under `conformance-results/`.

## Repository Scope

Records itself is commercial closed-source software. This repository contains
only the open-source validator packages extracted from Records.

This public repository must not contain the Records web application, Records
API server, database schema, migrations, repositories, governance reports,
customer integrations, environment files, or commercial deployment
configuration.

`@records-fhir/bundled-profiles` is intentionally excluded from the default export until all bundled upstream FHIR and implementation-guide artifact licenses have been reviewed. Re-run the export with `--include-bundled-profiles` only after that review.

The validator packages are designed for standalone embedding. Host applications
can provide optional profile, rule, persistence, and logging integrations
through explicit package APIs.

## FHIR Version Support

The package supports public FHIR versions `R4`, `R4B`, `R5`, and `R6`.
R4B routes through the R4 internal validation path because R4B is a maintenance
release of R4 with compatible StructureDefinition and FHIRPath context for this
validator mode.

## Validation Evidence

Current HL7 `FHIR/fhir-test-cases` JSON resource validation status:

- Upstream manifest entries: 969.
- Pre-filtered out before validation: 438.
- Candidate JSON comparison set: 531.
- Runtime skipped from the headline lane: 35.
- Executed and compared against Java `OperationOutcome`: 496.
- 496 passed.
- Failed/errors: 0.
- Headline JSON resource parity: 100.0%.
- Launch-discovery lane: 547/547 comparisons passed, 0 skipped, 0 failed.

Evidence artifacts:

- [`conformance-results/report-2026-05-09.json`](./conformance-results/report-2026-05-09.json)
- [`conformance-results/baseline-backlog-discovery-2026-05-03.json`](./conformance-results/baseline-backlog-discovery-2026-05-03.json)
- [`conformance-results/mii-triangulation-2026-05-09.json`](./conformance-results/mii-triangulation-2026-05-09.json)

The 438 pre-filtered entries are not counted as failures because they do not
exercise the thing this harness measures: JSON FHIR resource validation with a
Java `OperationOutcome` baseline. They include XML resources, older FHIR
versions, unsupported modules (SHC, CDA, CDS Hooks, JSON5, XVer, DSIG, HL7 v2),
disabled upstream tests, logical models, or entries without a declared Java
baseline.

The 35 headline runtime skips are measured by the explicit
`--include-baseline-backlog` discovery lane. That lane now executes 547
launch-discovery comparisons, including discovery-only FML/NDJSON, JSON5,
DSIG JSON, and hidden-Java-outcome fixtures, with 0 skips.

The scope expansion plan is tracked in
[`docs/conformance-scope-roadmap.md`](./docs/conformance-scope-roadmap.md).

### Why So Many Manifest Entries Are Not Counted

The HL7 manifest is broader than "validate one FHIR JSON resource and compare
the validator output." It also contains test assets for other formats,
protocols, historical versions, and adjacent standards. Counting those as
validator failures would make the metric less honest: it would mix unsupported
product scope with actual JSON resource validation correctness.

| Excluded class | Why it is not part of this score | What would be needed to include it |
|---|---|---|
| XML resources | The package currently validates parsed JSON resources. XML requires parsing, XML-specific diagnostics, and stable XML-to-resource location mapping. | Add an XML parser/normalizer and an XML-aware diagnostic mapper, then run XML fixtures as a separate conformance lane. |
| CDA, HL7 v2, CDS Hooks, SHC, DSIG, JSON5, XVer | These are adjacent standards or special harnesses, not plain FHIR JSON resource validation. Some are transformation/signature/protocol tests rather than resource validation tests. | Build dedicated modules and dedicated conformance harnesses for each format/protocol. |
| Older FHIR versions (`3.0`, `3.0.1`, `1.4`) | The validator package targets R4, R5, and R6. Legacy STU3/DSTU-era behavior differs enough that it should not be silently mixed into the R4 score. | Add explicit legacy-version support and report it as a separate compatibility score. |
| Upstream-disabled tests | The upstream manifest marks them with `use-test: false`, so the reference suite itself does not treat them as active comparison cases. | Re-enable only if upstream enables them or if this project defines its own expected baseline. |
| Logical model tests | Logical models are not ordinary FHIR resource-instance validation cases. | Add logical-model validation support and a separate result category. |
| Missing Java baselines | The comparison metric is Java parity. Without an expected Java `OperationOutcome`, there is no objective diff target. | Generate and commit Java baselines, or define a Records-owned expected baseline with a different metric name. |
| `.fml` / `.ndjson` payloads | They pass the manifest filter but are not single JSON resource documents. | Add FML/NDJSON-specific loaders and compare them in dedicated lanes. |

For that reason, the headline number should be read as:

> Records matches the Java validator on 496/496 currently executable FHIR JSON
> resource validation comparisons.

It should not be read as:

> Records implements every format, protocol, legacy version, and adjacent
> standard represented somewhere in the upstream manifest.

Spec dispatch coverage for the measured R4 base package constraints is 100%.

## MII 2026 Reference Scope

MII conformance is measured in a separate lane from the HL7
`FHIR/fhir-test-cases` score. The current scoped MII-2026 reference run
matches the official MII FHIR Validator on 241/241 measured resources from the
refreshed MII 2026 corpus under the `mii-2026-reference` profile scope and
`mii-local-blaze` terminology mode, with 12 classified corpus/profile-drift
skips.

This is a scoped parity claim for the measured package-example corpus. It is
not an MII certification claim and does not imply full site-level MII
Must-Support readiness.

## Examples

- [Standalone validation](./packages/validator/examples/standalone-validate.mjs)
- [Bulk folder validation](./packages/validator/examples/bulk-folder-validate.mjs)
- [GitHub workflow example](./packages/validator/examples/github-workflow.yml)

The package-level README contains the fuller API guide:
[`packages/validator/README.md`](./packages/validator/README.md).

## Development

```sh
npm install
npm run typecheck
npm run build
npm run oss:audit-validator
npm run oss:smoke-validator
```

## Publishing Order

1. Publish `@records-fhir/validation-types`.
2. Publish `@records-fhir/validator`.
3. Publish `@records-fhir/bundled-profiles` only after third-party license review.

## License

Apache-2.0 for the validator packages unless a package-level notice states otherwise. Bundled third-party FHIR artifacts retain their upstream licenses and notices.
