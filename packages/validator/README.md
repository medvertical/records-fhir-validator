# @records-fhir/validator

Pure TypeScript FHIR validation engine for R4, R4B, R5, and R6 resources.

The package validates FHIR resources against StructureDefinitions, FHIRPath constraints, terminology bindings, references, and optional custom rules without requiring a database or JVM. Records can wire database-backed profile and rule sources through dependency injection, while standalone consumers can run from local FHIR packages or optional bundled profiles.

This package is the open-source validator surface for `medvertical/records-fhir-validator`. The Records product itself is commercial closed source; it is not part of this package.

[![npm](https://img.shields.io/npm/v/@records-fhir/validator)](https://www.npmjs.com/package/@records-fhir/validator)
[![FHIR](https://img.shields.io/badge/FHIR-R4%20%7C%20R4B%20%7C%20R5%20%7C%20R6-blue)](#fhir-version-routing-r4b)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

## Two-Minute Quickstart

Run the CLI against one resource:

```sh
npx -p @records-fhir/validator records-fhir-validator ./patient.json
```

Validate a folder and fail CI on warnings:

```sh
npx -p @records-fhir/validator records-fhir-validator ./fixtures --fail-on=warning
```

Embed the TypeScript API:

```ts
import { recordsValidator } from '@records-fhir/validator';

const issues = await recordsValidator.validate(
  { resourceType: 'Patient', id: 'example' },
  'http://hl7.org/fhir/StructureDefinition/Patient',
  'R4',
);
```

Gate pull requests with the GitHub Action:

```yaml
- uses: medvertical/records-fhir-validator@v0
  with:
    paths: resources/**/*.json
    fhir-version: R4
    fail-on: error
```

## Repository Boundary

This package is designed to be published from the separate public repository
`medvertical/records-fhir-validator`.

Included in the public boundary:

- Pure TypeScript validator runtime.
- Validation orchestration and executors.
- StructureDefinition loading from filesystem/FHIR package sources.
- FHIRPath invariant execution.
- Terminology, reference, slicing, extension, metadata, and Bundle validators.
- OperationOutcome conversion helpers.
- Optional dependency injection hooks for host applications.

Excluded from the public boundary:

- Records web application.
- Records Express API routes and controllers.
- Records database schema, migrations, repositories, and storage services.
- Governance evidence reports and commercial workflow code.
- Customer-specific integrations, authentication, and deployment configuration.

## Install

```sh
npm install @records-fhir/validator @records-fhir/validation-types
```

For offline profile validation, install the optional profile bundle:

```sh
npm install @records-fhir/bundled-profiles
```

### Pinning

Three valid ways to pin the GitHub Action that wraps this validator,
depending on your trade-off between freshness and stability:

| Goal | Pin in `uses:` | Notes |
|---|---|---|
| Always-latest within current major | `medvertical/records-fhir-validator@v0` | Force-moved on every stable release; never advances onto a prerelease |
| Specific minor/patch (recommended for production CI) | `medvertical/records-fhir-validator@v0.4.0` | Immutable once published |
| Bit-exact reproducibility | `medvertical/records-fhir-validator@<commit-sha>` | For audit / forensic builds |

The `validator-v<semver>` tag you may see on the public repo's release
page is the **npm tarball mirror** identifier — it titles the GitHub
release and lets you cross-reference a public-repo commit against an
npm tarball. It is not intended as a consumer pin; use `v<semver>` for
Action references.

## Examples

Three copy-pasteable starting points ship in
[`examples/`](./examples/README.md):

- `standalone-validate.mjs` — validate a single JSON file from a Node
  script.
- `bulk-folder-validate.mjs` — walk a folder, validate every `*.json`,
  exit non-zero on any error.
- `github-workflow.yml` — drop into `.github/workflows/` to gate PRs
  with the composite Action.

## Usage

### CLI

The npm package installs a small CLI for local checks and CI scripts:

```sh
records-fhir-validator <file-or-folder...> [options]
```

Common options:

| Option | Default | Purpose |
|---|---|---|
| `--profile-url <url>` | base profile for each `resourceType` | Validate every resource against one canonical profile. |
| `--fhir-version R4\|R4B\|R5\|R6` | `R4` | Select the public FHIR version. |
| `--fail-on error\|warning\|none` | `error` | Control the process exit threshold. |
| `--format text\|json` | `text` | Print human-readable lines or structured JSON. |
| `--output <file>` | stdout | Write validation output to a file. Parent directories are created. |
| `--summary-only` | off | Omit per-issue output and print only aggregate counts. |
| `--include <glob>` | `**/*.json` | Include matching JSON files when walking folders. Repeatable or comma-separated. |
| `--exclude <glob>` | none | Exclude matching JSON files when walking folders. Repeatable or comma-separated. |

Example JSON output:

```sh
npx -p @records-fhir/validator records-fhir-validator ./patient.json --format=json
```

Write a CI report while validating only selected files:

```sh
npx -p @records-fhir/validator records-fhir-validator ./fixtures \
  --include 'fixtures/**/*.json' \
  --exclude 'fixtures/drafts/**' \
  --format=json \
  --summary-only \
  --output validation-report.json
```

Exit codes are stable for CI:

| Code | Meaning |
|---:|---|
| `0` | Validation completed and did not meet the `--fail-on` threshold. |
| `1` | Validation completed and met the `--fail-on` threshold. |
| `2` | Invalid CLI input, unreadable paths, no matched JSON files, or output write failure. |

```json
{
  "summary": { "files": 1, "errors": 0, "warnings": 1, "issues": 1 },
  "results": [
    {
      "file": "/workspace/patient.json",
      "resourceType": "Patient",
      "profileUrl": "http://hl7.org/fhir/StructureDefinition/Patient",
      "issues": [
        {
          "severity": "warning",
          "code": "terminology-binding-preferred",
          "path": "Patient.gender",
          "message": "Code is outside the preferred value set."
        }
      ]
    }
  ]
}
```

## Local Quality Guarantees

The 0.2.x release line is backed by local checks that do not require GitHub
Actions:

```sh
npm run quality:validator-perf-baseline
npx vitest run packages/validator/src/core/__tests__/golden-quality-corpus.test.ts
npm run architecture:validator-mirror
npm run oss:smoke-validator
```

What these checks cover:

- CLI behavior: help text, report writing, summary-only mode, include/exclude
  filters, output errors, and stable exit code `2` for usage/input failures.
- Golden defect anchors: representative R4 fixtures are matched by severity,
  issue-code family, path pattern, and stable issue fingerprints rather than
  brittle message text.
- Local performance baseline: 25 generated R4 fixtures, local-only terminology,
  no HTTP terminology calls, separated cold-start/warmup/measured windows,
  peak RSS tracking, and budget checks for mean/p95/worst timings.
- Public package boundary: mirror imports and packed npm-package smoke tests.

### Known Limits

- The CLI validates JSON resources and folders of JSON resources. XML, Turtle,
  CDA, HL7 v2, NDJSON, FML, CDS Hooks, SHC, and DSIG need dedicated loaders or
  validators and are tracked outside the headline JSON-resource scope.
- Local-only terminology avoids network calls. It can verify bundled/local
  expansions, but server-only terminology semantics require explicit terminology
  server configuration from embedder code.
- Golden corpus assertions are contract anchors, not exact OperationOutcome
  snapshots. This is intentional: message wording can improve without breaking
  the defect-detection guarantee.

### Quick start (singleton)

For most use cases, use the lazy singleton — no class instantiation,
profile source pre-wired to the package's defaults:

```ts
import {
  recordsValidator,
  setProfileSource,
  createFilesystemProfileSource,
} from '@records-fhir/validator';

// Optional: point at a local FHIR package directory.
// Skip this if `~/.fhir/packages` is populated or you installed
// `@records-fhir/bundled-profiles`.
setProfileSource(createFilesystemProfileSource({
  packageDirs: ['./fhir-packages'],
}));

const issues = await recordsValidator.validate(
  { resourceType: 'Patient', id: 'example', name: [{ family: 'Doe' }] },
  'http://hl7.org/fhir/StructureDefinition/Patient',
  'R4', // 'R4' | 'R4B' | 'R5' | 'R6'
);
```

For ordered batch output, use `validateAll`. It preserves input order and wraps
each resource with `isValid`, `index`, `resourceType`, `id`, and `issues` while
using the optimized batch path when all inputs share profile/settings:

```ts
const results = await recordsValidator.validateAll([
  { resource: { resourceType: 'Patient', id: 'p1' } },
  {
    resource: { resourceType: 'Observation', id: 'o1', status: 'final' },
    profileUrl: 'http://hl7.org/fhir/StructureDefinition/Observation',
  },
], {
  fhirVersion: 'R4',
  maxConcurrency: 8,
  continueOnError: true,
});
```

### Class form (full control)

```ts
import { getRecordsValidatorClass } from '@records-fhir/validator';

const RecordsValidator = await getRecordsValidatorClass();
const validator = new RecordsValidator({
  enableCaching: true,
  strictMode: false,
});

const issues = await validator.validate({ resourceType: 'Patient' });
```

### FHIR version routing (R4B)

`PublicFhirVersion` accepts `'R4' | 'R4B' | 'R5' | 'R6'`. R4B is
routed through the R4 internal path because R4B is a maintenance
release of R4 with the same StructureDefinitions and FHIRPath
context. Use `toInternalFhirVersion` to apply the same mapping in
embedder code:

```ts
import { toInternalFhirVersion, type PublicFhirVersion } from '@records-fhir/validator';

const v: PublicFhirVersion = 'R4B';
toInternalFhirVersion(v); // → 'R4'
```

### Stable issue fingerprints

Use `issueFingerprint` when storing regression snapshots or grouping validation
findings across releases. It is stable across wording, `details`, timestamps,
and generated issue IDs; it changes when the issue identity changes
(`severity`, `code`, `path`, `resourceType`, `profile`, or `ruleId`).

```ts
import { issueFingerprint } from '@records-fhir/validator';

const fingerprint = issueFingerprint(issues[0]);
```

### Apply a fix-suggestion patch

The catalog ships ~290 structured patches; `applyFixPatch` is the
executor:

```ts
import { applyFixPatch, getFixSuggestion } from '@records-fhir/validator';

const suggestion = getFixSuggestion('terminology-binding-required');
const result = applyFixPatch(
  { resourceType: 'Patient', id: 'p1' },
  { action: 'add', path: 'Patient.gender', value: 'other' },
);
// result.applied → true
// result.resource → { resourceType: 'Patient', id: 'p1', gender: 'other' }
```

### Custom Rules with the FHIRPath sandbox

User-defined Custom Rules go through a static safety pre-flight
before fhirpath.js evaluates them. Pathological expressions
(unbounded `repeat()`, deep `where()` nesting, megabyte regexes) are
rejected with a clear reason; legitimate FHIR core constraints sit
well under the limits.

```ts
import { checkFhirpathSandbox } from '@records-fhir/validator';

checkFhirpathSandbox('Patient.name.exists()');
// → { ok: true, metrics: { expressionLength: 21, functionCallCount: 1, nestingDepth: 1 } }

checkFhirpathSandbox('a'.repeat(5000));
// → { ok: false, reason: 'Expression length 5000 exceeds limit 4096', metrics: { ... } }
```

### Routing engine logs

By default the engine logs to `console.{debug,info,warn,error}`. Wire
in your own logger (Winston, pino, …) via `setEngineLogger`:

```ts
import { setEngineLogger } from '@records-fhir/validator';

setEngineLogger({
  debug: () => {},                       // silence debug
  info:  (msg, meta) => myLogger.info(msg, meta),
  warn:  (msg, meta) => myLogger.warn(msg, meta),
  error: (msg, meta) => myLogger.error(msg, meta),
});
```

## Public Imports

Most consumers should import from the package root:

```ts
import { getRecordsValidatorClass, ValueSetValidator } from '@records-fhir/validator';
```

Advanced integrations can use the explicitly exported subpaths in `package.json`, for example:

```ts
import { toOperationOutcome } from '@records-fhir/validator/core/operation-outcome-converter';
```

Deep imports that are not listed in `exports` are internal and can change without notice.

## Standalone vs. Records Integration

Standalone use does not require a database, Records API server, or Java. Host
applications can provide optional integration hooks for profile resolution,
custom business rules, and logging.

Records uses the same validator as its default engine, but the Records
application code is not required to embed this package.

## Embedder Boundaries

The package does not import Records server modules, database code, Express handlers, or application settings. Embedders can provide optional integration points:

- `setProfileSource()` for database-backed or remote profile resolution.
- `setCustomRulesSource()` for user-defined business rules.
- `setEngineLogger()` for host logging.

Without these integrations, the validator uses no-op defaults and runs as a standalone offline validator.

## Practical Scope

Use this package when you need a TypeScript-native validator that runs in Node,
CI, GitHub Actions, or product backends without starting the Java validator.
It is strongest for FHIR JSON resource validation, StructureDefinition
constraints, slicing, references, terminology checks, and structured issue
metadata that downstream applications can store or display.

The package is not a claim of universal FHIR ecosystem coverage. XML resources,
CDA, HL7 v2, CDS Hooks, SHC, DSIG, JSON5 harnesses, legacy STU3/DSTU versions,
logical models, and site-level MII certification are outside the current
headline support scope unless called out by a dedicated conformance lane.

## Conformance

Current HL7 `FHIR/fhir-test-cases` status: 100.0% of executable comparison
tests passing. The latest local report was generated on 2026-06-30 from pinned
upstream commit `431b37cd06cac878bc23b4a8b457c2f2397fdcdc`. The local artifact
used for this update was
`conformance-results/report-2026-06-30.json`.

The upstream manifest contains more than 900 entries. Records does not claim
that all manifest entries are executable in the current TypeScript validator
mode. The reported 100.0% applies to the JSON resource validation subset that
can be compared against the Java validator's expected `OperationOutcome`.

| Stage | Count | Meaning |
|---|---:|---|
| Upstream manifest entries | 974 | All entries in `FHIR/fhir-test-cases/validator/manifest.json` at commit `431b37c`. |
| Pre-filtered out | 438 | Not executable by this harness: the current comparison runner measures JSON FHIR resource validation against Java `OperationOutcome` baselines, not XML, non-resource formats, disabled upstream cases, unsupported modules, logical models, or cases without a Java baseline. |
| Candidate comparison set | 536 | R4/R5/R6 or unversioned JSON-oriented entries with a declared Java baseline. |
| Runtime skipped | 40 | Candidate entries kept outside the headline JSON score because their Java baseline output is not available locally. |
| Executed and compared | 496 | Records result was normalized to `OperationOutcome` and diffed against Java. |
| Passed | 496 | All executable comparisons passed. |

Reproduce the headline lane locally with:

```sh
npm run conformance -- --tx-server none --output-file conformance-results/report-local.json
```

Pre-filter exclusions:

| Reason | Count |
|---|---:|
| XML resources (Records validator is JSON-only) | 296 |
| Non-R4/R5/R6 FHIR versions (`3.0`, `3.0.1`, `1.4`) | 47 |
| Unsupported modules: SHC, CDA, CDS Hooks, JSON5, XVer, DSIG, HL7 v2 | 74 |
| Disabled by upstream manifest (`use-test: false`) | 17 |
| No Java baseline declared in the manifest | 3 |
| Logical model test | 1 |

Runtime skips inside the 536 candidate set for the headline lane:

| Reason | Count |
|---|---:|
| Java baseline output not found | 40 |

The Java baseline backlog is measured separately with the explicit
`--include-baseline-backlog` discovery flag. The 2026-05-03 discovery run
resolves known upstream Java baseline path drift, includes explicit FML/NDJSON
parser-baseline fixtures, synthesizes the missing empty Java outcome for
`cw-slice-compatible`, admits JSON5 and DSIG JSON harness cases, and includes
two hidden Java-outcome fixtures. It runs the launch-discovery set:
547/547 passing, 0 skips, 0 failures. The report's `passRate` is 100.0%;
`similarityScore` may read 99.7% because it averages semantic diff similarity
for six approximate-but-passing Java parity cases. The backward-compatible
`overallScore` field remains an alias for `similarityScore`.

Excluded tests are tracked separately so the headline score does not imply XML,
HL7 v2, CDA, CDS Hooks, DSIG, JSON5, SHC, or logical-model support.

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

The spec dispatch coverage report is also at 100% for the R4 base package
constraints measured by `quality:spec-coverage`.

### MII 2026 Reference Scope

MII conformance is measured in a separate lane from the HL7
`FHIR/fhir-test-cases` score. The current scoped MII-2026 reference run was
generated on 2026-07-01 against the official MII FHIR Validator container
`mii-fhir-validator:0.0.1-alpha.7` at `http://localhost:8081`. It matches the
reference validator on 231/231 measured resources from the refreshed MII 2026
corpus under the `mii-2026-reference` profile scope and `mii-local-blaze`
terminology mode, with 22 classified skips: 12 corpus/profile-drift skips and
10 reference-terminology-incomplete skips. The run prewarmed 128/128
reference-scope profiles before executing the cases. The
source-repository report is
`conformance-results/mii-triangulation-2026-07-01.json`.

This is a scoped parity claim for the measured package-example corpus. It is
not an MII certification claim and does not imply full site-level MII
Must-Support readiness.

The full scope-expansion plan is tracked in
`docs/product/conformance-scope-roadmap.md` in the Records source repository.
The public `medvertical/records-fhir-validator` export includes the same
roadmap under `docs/conformance-scope-roadmap.md`.

### FHIR Schema Dual-Path Scope

FHIR Schema is being evaluated as a cleaner intermediate representation for
the same StructureDefinition semantics, not as a replacement for conformance
evidence. The current engine remains StructureDefinition-first. The FHIR Schema
graph path runs in parallel and is compared against both Records' current
StructureDefinition path and Java/reference `OperationOutcome` evidence where a
reference report exists.

The current all-scope MII dual-path lane covers 555 real fixtures. Of those, 477
have Java/reference coverage through the attached Java CLI supplement
(`conformance-results/fhir-schema-reference-cli-supplement-all-2026-06-30.json`).
The final report is
`conformance-results/fhir-schema-dual-path-all-2026-06-30.json`.

The lane reports 416 clean cases, 58 exact Graph/Records comparable matches, 26
graph-only cases, 0 Records-only cases, 0 divergent cases, 55 missing-profile
cases, and 0 execution errors. Both TypeScript paths match 75 normalized
Java/reference issue keys; no Java-covered issue is currently classified as
`graph-aligns-reference-records-missing`,
`records-aligns-reference-graph-missing`, or `both-miss-reference`.

Reference coverage is reported separately from graph-vs-Records correctness. The
remaining 78 reference-coverage gaps are 43 fixtures without an explicit
`meta.profile` and 35 fixtures without a reference-report entry. The CLI
supplement is Java `OperationOutcome` evidence for expanding the dual-path lane;
it does not replace the official MII HTTP reference validator container for
headline MII parity claims.

The report classifies the remaining cases instead of hiding them in one score:
60 three-way-match cases, 25 local-engine-vs-reference-unconfirmed cases, 26
graph-only-unconfirmed cases, 35 no-reference cases, 43 no-profile cases, and 12
intentionally unmapped profile cases. The intentionally excluded classes are part
of the evidence model: unsupported or unmapped corpus profiles, fixtures without
an explicit profile, reference entries that have not yet been generated, Java
informational hints, and reference-runtime behavior caused by unavailable
terminology versions.

The open decision buckets are explicit. Shared local-vs-reference signals are
mostly `code.coding` slice cardinality, `category`/`category.coding` strictness,
and `value.code` pattern checks. Graph-only unconfirmed signals are
`category.coding` slice cardinality, oncology extension fixed-value strictness,
one masked-identifier child cardinality case, and single required/forbidden
`code.coding` slice-cardinality cases. These remain visible until
Java/reference coverage or an explicit product decision promotes them into
runtime behavior.

This lane is therefore an implementation-reduction and convergence signal. It
does not broaden the public headline parity claim beyond the explicitly measured
FHIR JSON comparison lanes.

## License

Apache-2.0 for this package. The surrounding Records application remains proprietary and is licensed separately.
