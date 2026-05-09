# Validator Source Layout

This directory contains the pure TypeScript FHIR validator runtime that is
published through `@records-fhir/validator`.

The source is part of the open-source `medvertical/records-fhir-validator`
boundary. The surrounding Records application remains commercial closed-source
software and is not required to use this runtime.

## Boundary Rules

Allowed dependencies:

- `@records-fhir/validation-types`
- FHIR/FHIRPath runtime libraries used by the package
- Node.js standard library
- Package-local modules under `packages/validator/src`

Disallowed dependencies:

- Records server routes, controllers, repositories, storage, or database code
- Records React application modules
- Records authentication, deployment, billing, reporting, or governance workflow code
- Environment-specific configuration or customer data

Run the boundary audit before publishing:

```sh
npm run oss:audit-validator
node scripts/oss/audit-validator-boundary.mjs --include-tests
```

## Main Areas

| Directory | Purpose |
|---|---|
| `core/` | Validation orchestration, StructureDefinition loading, batching, OperationOutcome conversion |
| `validators/` | Structural, profile, terminology, reference, invariant, Bundle, slicing, extension, and metadata validators |
| `reference/` | Reference parsing and resolution helpers |
| `metadata/` | Metadata-specific validators |
| `package/` | FHIR package registry/download/cache helpers |
| `persistence/` | Host-provided persistence contracts and no-op defaults |
| `advisor/` | Post-validation advisor rules and issue normalization |
| `strictness/` | Strictness filtering shared by host integrations |

## Public Entry Points

Consumers should normally import from the package root:

```ts
import { getRecordsValidatorClass, ValueSetValidator } from '@records-fhir/validator';
```

Stable subpaths are listed in `packages/validator/package.json` under
`exports`. Anything else is internal and can change without notice.

## Conformance

Current HL7 `FHIR/fhir-test-cases` status:

- Upstream manifest entries: 969.
- Pre-filtered out before validation: 438 because this harness measures JSON FHIR resource validation against Java `OperationOutcome` baselines, not XML, non-resource formats, disabled upstream cases, unsupported modules, logical models, or cases without a Java baseline.
- Candidate JSON comparison set: 531.
- Runtime skipped: 35.
- Executed and compared against Java `OperationOutcome`: 496.
- Passed: 496.
- Failed/errors: 0.
- Executable comparison score: 100.0%.
- Baseline-backlog discovery: 547/547 executed comparisons (100.0% pass
  rate), with 0 skips and 0 failures.

The 438 pre-filtered entries are not counted as failures because they do not
exercise the thing this harness measures: JSON FHIR resource validation with a
Java `OperationOutcome` baseline. They include XML resources, older FHIR
versions, unsupported modules (SHC, CDA, CDS Hooks, JSON5, XVer, DSIG, HL7 v2),
disabled upstream tests, logical models, or entries without a declared Java
baseline.

The 35 headline runtime skips are measured by the explicit
`--include-baseline-backlog` discovery lane. That lane now executes 547
launch-discovery comparisons, including discovery-only FML/NDJSON,
JSON5, DSIG JSON, and hidden-Java-outcome fixtures, with 0 skips.

The spec dispatch coverage report is also at 100% for the measured R4 base
package constraints.

See `docs/product/conformance-scope-roadmap.md` in the Records source
repository for the full explanation of skipped test classes and the XML/NDJSON
scope-expansion plan.

## Development

```sh
npm run typecheck --workspace @records-fhir/validator
npm run build --workspace @records-fhir/validator
npm run pack:dry --workspace @records-fhir/validator
npm run oss:audit-validator
```

For full repository verification:

```sh
npm run quality:spec-coverage -- --stdout
npm run conformance:affected -- --files packages/validator/src/validators/bundle-validator.ts
```

## License

Apache-2.0 for the validator package. Records application code outside this
package is proprietary unless a separate package-level license says otherwise.
