
# Records FHIR Validator

Pure TypeScript FHIR validator for CI pipelines, GitHub Actions, and
standalone Node.js use. Its CLI accepts FHIR JSON, XML, and NDJSON and validates
the normalized resources against
StructureDefinitions, FHIRPath invariants, terminology bindings, references,
slicing, extensions, Bundle rules, metadata, and optional custom rules without
requiring a JVM, database, or Records server.

[![npm](https://img.shields.io/npm/v/@records-fhir/validator)](https://www.npmjs.com/package/@records-fhir/validator)
[![CI](https://github.com/medvertical/records-fhir-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/medvertical/records-fhir-validator/actions/workflows/ci.yml)
[![FHIR](https://img.shields.io/badge/FHIR-R4%20%7C%20R4B%20%7C%20R5%20%7C%20R6-blue)](#fhir-version-support)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![HL7 JSON archived](https://img.shields.io/badge/HL7%20JSON%20archived-533%2F533-brightgreen)](#validation-evidence)
[![MII scope archived](https://img.shields.io/badge/MII%202026%20archived-231%2F231-brightgreen)](#mii-2026-reference-scope)
[![FHIR Schema archived](https://img.shields.io/badge/FHIR%20Schema%20archived-0%20Records--only-brightgreen)](#fhir-schema-dual-path-scope)

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
- uses: medvertical/records-fhir-validator@v0.7.0
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
| Exact released version | `medvertical/records-fhir-validator@v0.7.0` | Immutable consumer tag |
| Bit-exact reproducibility | `medvertical/records-fhir-validator@<commit-sha>` | Best for audit and forensics |

The `validator-v<semver>` tag is the npm mirror/release-page tag. Use
`v<semver>` or a commit SHA for GitHub Action pins.

### npm Package

```sh
npm install @records-fhir/validator@0.7.0 @records-fhir/validation-types@0.1.12
```

Run the CLI against one file or a folder:

```sh
npx -p @records-fhir/validator records-fhir-validator ./patient.json
npx -p @records-fhir/validator records-fhir-validator ./fixtures --fail-on=warning
npx -p @records-fhir/validator records-fhir-validator ./patient.json --format=json
npx -p @records-fhir/validator records-fhir-validator ./fixtures --summary-only --output validation-report.json
```

Useful CLI options:

| Option | Default | Purpose |
|---|---|---|
| `--profile-url <url>` | base profile for each `resourceType` | Validate every resource against one canonical profile. |
| `--fhir-version R4\|R4B\|R5\|R6` | `R4` | Select the public FHIR version. |
| `--fail-on error\|warning\|none` | `error` | Control the process exit threshold. |
| `--format text\|json` | `text` | Print human-readable lines or structured JSON. |
| `--output <file>` | stdout | Write validation output to a file. Parent directories are created. |
| `--summary-only` | off | Omit per-issue output and print only aggregate counts. |
| `--include <glob>` | JSON, XML, and NDJSON globs | Include matching FHIR input files when walking folders. Repeatable or comma-separated. |
| `--exclude <glob>` | none | Exclude matching FHIR input files when walking folders. Repeatable or comma-separated. |

CLI exit codes:

| Code | Meaning |
|---:|---|
| `0` | Validation completed and did not meet the `--fail-on` threshold. |
| `1` | Validation completed and met the `--fail-on` threshold. |
| `2` | Invalid CLI input, unreadable paths, no matched FHIR input files, or output write failure. |

Validate a resource from Node.js:

```ts
import { recordsValidator } from '@records-fhir/validator';

const issues = await recordsValidator.validateRequest({
  resource: { resourceType: 'Patient', id: 'example' },
  profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
  fhirVersion: 'R4',
});
```

Optional offline profile packages can be loaded through the package APIs. The
default public repository export intentionally excludes bundled third-party IG
artifacts until their upstream licenses and notices have been reviewed.

## Output Shape

The validator emits structured issues that are intended for CI annotations,
database storage, and UI display:

```json
{
  "severity": "warning",
  "code": "terminology-binding-preferred",
  "path": "Patient.gender",
  "message": "Code is outside the preferred value set."
}
```

The CLI text mode prints one issue per line and exits according to
`--fail-on`. JSON mode returns `{ summary, results }`, where each result
includes `file`, `resourceType`, `profileUrl`, and `issues`. With
`--summary-only`, JSON mode returns only `{ summary }`.

## What Is Included

- `@records-fhir/validator` 0.7.0 - Apache-2.0 validation engine.
- `@records-fhir/validation-types` 0.1.12 - Apache-2.0 validation-domain types.
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

## Practical Scope

Use this project when you need a TypeScript-native validator that runs in Node,
CI, GitHub Actions, or product backends without starting the Java validator.
It is strongest for FHIR JSON resource validation, StructureDefinition
constraints, slicing, references, terminology checks, and structured issue
metadata that downstream applications can store or display.

It is not a universal FHIR ecosystem implementation. XML and NDJSON input do
not change the JSON parity headline. CDA, HL7 v2, CDS Hooks, SHC, DSIG, JSON5
harnesses, legacy STU3/DSTU versions, logical models, and site-level MII
certification are outside the current headline support scope unless called out
by a dedicated conformance lane.

## FHIR Version Support

The package supports public FHIR versions `R4`, `R4B`, `R5`, and `R6`.
R4B keeps the `hl7.fhir.r4b.core#4.3.0` package identity through
`resolveFhirReleaseContext()`; validation and FHIRPath evaluation currently
use the documented R4 maintenance adapter.

## Validation Evidence

Historical evidence set: `validator-archived-evidence-2026-09-09`. Explicitly pinned tracked reports, preserving their original recorded outcomes and exclusions. These measurements do not certify the currently exported package versions.

The explicit report selection and SHA-256 hashes are in [`release/validator-evidence.json`](./release/validator-evidence.json).
The exporting package versions are listed above. They are not the measured versions of these historical runs.

HL7 JSON measurement: 2026-08-25T09:29:45.985Z; recorded Records application version: 0.10.1.

- Upstream manifest entries: 969; pre-filtered: 433; candidates: 536.
- Executed comparisons: 533; recorded passed: 533; failed: 0; errors: 0; runtime skipped: 3.
- Java baseline corpus commit: `8923095fc5e3750025f7dd71988c9e89083b1487`.
- Scope: FHIR JSON resource comparisons under the recorded report policy. XML, adjacent standards and pre-filtered fixtures are excluded.
- Source report: [`conformance-results/report-2026-08-24.json`](./conformance-results/report-2026-08-24.json).

The counts reproduce recorded statuses under that report’s comparison policy; they do not claim identical issue lists or a fresh measurement.

| Pre-filter reason recorded by the harness | Entries |
|---|---:|
| unsupported version (3.0) | 44 |
| XML resource (scored in the XML input lane) | 299 |
| disabled (use-test: false) | 17 |
| unsupported module (shc) | 11 |
| unsupported module (xver) | 13 |
| unsupported module (cda) | 4 |
| unsupported version (3.0.1) | 2 |
| unsupported version (1.4) | 1 |
| unsupported module (cdshooks) | 20 |
| unsupported module (json5) | 8 |
| unsupported module (v2) | 4 |
| logical model test | 1 |
| unsupported module (dsig) | 8 |
| no java baseline | 1 |

Runtime skip reasons: Configured terminology server lacks the SNOMED national edition required by the fixture: http://snomed.info/sct (3).

## MII 2026 Reference Scope

Measurement: 2026-07-23T10:42:01.818Z; profile scope: `mii-2026-reference`; terminology: `mii-local-blaze`.
231/231 measured resources passed, 0 failed, 0 execution errors, 22 skipped. MII package-example resources in the recorded profile/terminology scope; not site certification or full Must-Support readiness.
Source report and measured IG package versions: [`conformance-results/mii-triangulation-2026-07-23.json`](./conformance-results/mii-triangulation-2026-07-23.json).

## FHIR Schema Dual-Path Scope

Measurement: 2026-07-23T10:56:55.070Z. 555 fixtures; 512 reference-covered.
418 clean, 71 matched, 11 graph-only, 0 Records-only, 0 divergent, 55 profile-missing, 0 execution errors.
Graph/current-engine comparison for selected structural/profile issue families; does not broaden the headline JSON lane.
Report: [`conformance-results/fhir-schema-dual-path-all-2026-07-23.json`](./conformance-results/fhir-schema-dual-path-all-2026-07-23.json); reference supplement: [`conformance-results/fhir-schema-reference-cli-supplement-all-2026-07-01.json`](./conformance-results/fhir-schema-reference-cli-supplement-all-2026-07-01.json).

### Provenance limits and archived support

Legacy reports do not record the npm validator/validation-types package versions or tested source revision; null means unknown and must not be filled from the exporting checkout.
Oracle identities are declared per lane; unrecorded executable versions remain unknown. The artifact snapshot revision identifies stored files, not the tested runtime revision.

<details><summary>Explicitly selected historical artifacts</summary>

- [`conformance-results/baseline-passing.json`](./conformance-results/baseline-passing.json)
- [`conformance-results/baseline-backlog-discovery-2026-05-03.json`](./conformance-results/baseline-backlog-discovery-2026-05-03.json)
- [`conformance-results/hl7-validator-testkit-2026-05-20.json`](./conformance-results/hl7-validator-testkit-2026-05-20.json)
- [`conformance-results/report-2026-07-01.json`](./conformance-results/report-2026-07-01.json)
- [`conformance-results/report-2026-07-21.json`](./conformance-results/report-2026-07-21.json)
- [`conformance-results/report-2026-07-23.json`](./conformance-results/report-2026-07-23.json)
- [`conformance-results/mii-triangulation-2026-07-01.json`](./conformance-results/mii-triangulation-2026-07-01.json)
- [`conformance-results/mii-triangulation-2026-07-21.json`](./conformance-results/mii-triangulation-2026-07-21.json)
- [`conformance-results/mii-triangulation-2026-07-23.json`](./conformance-results/mii-triangulation-2026-07-23.json)
- [`conformance-results/fhir-schema-reference-cli-supplement-all-2026-07-01.json`](./conformance-results/fhir-schema-reference-cli-supplement-all-2026-07-01.json)
- [`conformance-results/fhir-schema-dual-path-all-2026-07-01.json`](./conformance-results/fhir-schema-dual-path-all-2026-07-01.json)
- [`conformance-results/fhir-schema-dual-path-all-2026-07-23.json`](./conformance-results/fhir-schema-dual-path-all-2026-07-23.json)
- [`conformance-results/fhir-schema-dual-path-actions-2026-07-01.json`](./conformance-results/fhir-schema-dual-path-actions-2026-07-01.json)
- [`conformance-results/fhir-schema-dual-path-actions-2026-07-01.md`](./conformance-results/fhir-schema-dual-path-actions-2026-07-01.md)
- [`conformance-results/validator-claims-2026-07-01.json`](./conformance-results/validator-claims-2026-07-01.json)
- [`conformance-results/validator-claims-2026-07-01.md`](./conformance-results/validator-claims-2026-07-01.md)
- [`conformance-results/validator-claims-2026-07-21.json`](./conformance-results/validator-claims-2026-07-21.json)
- [`conformance-results/validator-claims-2026-07-21.md`](./conformance-results/validator-claims-2026-07-21.md)
- [`conformance-results/validator-claims-2026-07-23.json`](./conformance-results/validator-claims-2026-07-23.json)
- [`conformance-results/validator-claims-2026-07-23.md`](./conformance-results/validator-claims-2026-07-23.md)
- [`conformance-results/report-2026-08-24.json`](./conformance-results/report-2026-08-24.json)

</details>


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
