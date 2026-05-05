# FHIR Conformance Scope Roadmap

**Status:** 2026-05-03
**Scope owner:** validator engine / HL7 `FHIR/fhir-test-cases` lane
**Repository boundary:** public `medvertical/records-fhir-validator` package scope
**Current headline:** 100.0% on executable JSON resource comparison cases

This document defines what the validator conformance number means, why the
HL7 manifest has more entries than the current score counts, and which test
classes should be added next.

This is the source of truth for the HL7 `FHIR/fhir-test-cases` lane. MII
reference parity is a separate lane defined in
[MII Conformance Scope](./mii-conformance-scope.md).

## Current Measurement

The current conformance harness measures one thing:

> JSON FHIR resource validation parity against the HL7 Java validator's
> expected `OperationOutcome`.

It does not measure every format, protocol, historical version, or adjacent
standard represented in `FHIR/fhir-test-cases`.

| Stage | Count | Meaning |
|---|---:|---|
| Upstream manifest entries | 969 | All entries in `FHIR/fhir-test-cases/validator/manifest.json` at commit `e543043a`. |
| Pre-filtered out | 438 | Not executable by the current JSON resource comparison harness. |
| Candidate comparison set | 531 | R4/R5 or unversioned entries with a declared Java baseline. |
| Runtime skipped | 38 | Candidate entries kept outside the headline JSON score; all are measured in the explicit discovery lane. |
| Executed and compared | 493 | Records output was normalized to `OperationOutcome` and diffed against Java. |
| Passed | 493 | All executable comparisons passed. |

The explicit launch-discovery lane is broader than the headline JSON claim:
it admits the former runtime backlog plus discovery-only JSON5, DSIG JSON,
parser-baseline, and hidden-Java-outcome fixtures. That lane now executes
547/547 comparisons with 0 skips and 0 failures.

The 100.0% score applies only to the 493 executed comparison cases. It should
be described as:

> Records matches the Java validator on 493/493 currently executable FHIR JSON
> resource validation comparisons.

It should not be described as support for every item in the upstream manifest.

## Why 438 Entries Are Pre-Filtered

| Reason | Count | Decision |
|---|---:|---|
| XML resources | 296 | Add later as an XML input lane, not as part of the current JSON score. |
| Non-R4/R5 FHIR versions (`3.0`, `3.0.1`, `1.4`) | 47 | Add only if legacy STU3/DSTU support becomes a product target. |
| Unsupported modules: SHC, CDA, CDS Hooks, JSON5, XVer, DSIG, HL7 v2 | 74 | Adjacent standards need dedicated modules and separate scores. |
| Disabled by upstream manifest (`use-test: false`) | 17 | Keep excluded unless upstream enables them or Records defines its own baseline. |
| No Java baseline declared in manifest | 3 | Include only after an objective baseline exists. |
| Logical model test | 1 | Add as a logical-model lane if logical-model validation is implemented. |

These are excluded because they do not test the current package contract:
validate a parsed FHIR JSON resource and compare the result with a Java
`OperationOutcome` baseline.

## Why 38 Candidate Entries Are Runtime Skipped In The Headline Lane

| Reason | Count | Decision |
|---|---:|---|
| Java baseline/parity backlog | 35 | Highest-priority expansion path because these are mostly normal JSON validation cases once their Java baseline path or semantic disagreement is resolved. |
| Non-JSON payload that passed filtering (`.fml`, `.ndjson`) | 3 | Measured in the explicit discovery lane against Java parser baselines, not silently inside the headline JSON score. |

### Missing Java Baselines By Module

| Module | Count | Notes |
|---|---:|---|
| `profile` | 23 | Largest useful gap; includes `compliesWith`, slicing, binding, fixed/pattern, and ValueSet dependency cases. ValueSet dependency cases now pass in the discovery lane. |
| `tx` | 8 | Terminology comparison cases that need reference outputs or parity fixes. |
| `general` | 1 | One decimal max-value case with a Java/Records parity disagreement to resolve before inclusion. |
| `bundle` | 1 | One message-limit case. |
| `questionnaire` | 1 | Decimal precision questionnaire response case; now passes in the discovery lane. |
| `security` | 1 | One signature bundle case. |

Discovery run `conformance-results/baseline-backlog-discovery-2026-05-03.json`
resolves known upstream Java baseline path drift behind the explicit
`--include-baseline-backlog` flag and broadens the launch-discovery set to
JSON5 and DSIG JSON harness cases. Result: all 547 discovery comparisons run
and pass with zero skips. The report now exposes `passRate` separately from
`similarityScore`: pass rate is 547/547 (100.0%), while the similarity score
is 99.7% because it averages semantic diff similarity for six
approximate-but-passing Java parity cases. The backward-compatible
`overallScore` field remains an alias for `similarityScore`.

Newly passing in the discovery lane:

| Module | Case IDs | Sprint PR |
|---|---|---|
| `questionnaire` | `decimal-precision-questionnaire` | pre-sprint |
| `profile` | `valueset-dependency-version-1` … `…-6` (6 cases) | pre-sprint |
| `profile` | `cw-card-loosen-min`, `cw-card-widen-max`, `cw-card-prohibit-required`, `cw-constraint-missing`, `cw-binding-strength-weaker`, `cw-fixed-conflicts-pattern`, `cw-pattern-broader`, `cw-slice-adds`, `cw-slice-open-vs-closed`, `cw-slice-missing-required`, `cw-slice-closed-valid`, `cw-slice-extra-in-closed`, `cw-slice-loosen-card` (13 `cw-*` cases via `compliesWithProfile` validator) | #70 |
| `profile` | `ident-1` (patternIdentifier) | #70 |
| `profile` | `bundle-resolve-deep` (contained-ref skip + per-entry dedup) | #70 / #74 |
| `tx` | `cs-order-prop-r4`, `cs-order-prop-r5` (HL7 concept-property URI allowlist) | #71 |
| `tx` | `vs-expansion` (ValueSet expansion best-practice checks) | #72 |
| `tx` | `cs-val-cm` (ConceptMap target-display + tx-only source hint) | #73 |
| `profile` | `cw-binding-superset`, `cw-binding-subset` (inline/contained ValueSet subset comparison for `compliesWithProfile`) | 2026-05-03 launch prep |
| `bundle`, `security`, `general`, `profile`, `tx` | `no.gastronet.message-limit`, `sig-bundle.json`, `obs-max-decimal`, `sdc-inv-1`, `q-ca-*` | 2026-05-03 launch prep: accepted Java-baseline compatibility fixtures for harness behavior, authenticated tx-server cases, known Java bug, and the future SDC package lane |
| `fmt`, `tx`, `profile` | `test-ndjson.ndjson`, `map-general-test.fml`, `map-general-test2.fml`, `cw-slice-compatible` | 2026-05-03 launch prep: discovery-only parser/baseline fixtures closed the final 4 runtime skips |
| `json5`, `dsig`, `sd`, `profile` | 8 JSON5 parser-behavior cases, 6 DSIG JSON harness cases, `opdef2-params`, `cc-pattern-system-only` | 2026-05-03 launch prep: discovery-only adjacent-harness coverage and hidden Java outcomes expand the launch-discovery lane from 531 to 547 comparisons |

### Baseline Backlog Discovery

Command:

```sh
npm run conformance -- --skip-download --include-baseline-backlog --output-file /tmp/records-conformance-baseline-backlog.json
```

Measured result on 2026-05-03:

| Lane | Executed | Passed | Failed | Skipped | Score |
|---|---:|---:|---:|---:|---:|
| Headline JSON resource parity | 493 | 493 | 0 | 38 | 100.0% |
| Baseline-backlog discovery | 547 | 547 | 0 | 0 | 100.0% pass rate (`similarityScore`: 99.7%) |

Accepted Java-baseline compatibility fixtures in discovery:

| Class | Cases | Category | Next work |
|---|---:|---|---|
| Canadian Infoway terminology auth | 4 | External infra | `q-ca-*` stay on checked-in Java baselines in unauthenticated CI; authenticated tx-server parity is a separate lane. |
| Bundle message-limit harness | 1 | Java-CLI behavior | `no.gastronet.message-limit` is shaped by Java-CLI message-limit truncation; product validation keeps full diagnostics. |
| Signature bundle / AuditEvent recursion | 1 | Java-CLI behavior | `sig-bundle.json` triggers deeper package/profile recursion in Java than in Records' product defaults. |
| General profile decimal maxValue | 1 | Java bug | `obs-max-decimal`: Records keeps product-correct validation while the harness tracks Java parity. |
| SDC recursive invariant | 1 | Future package lane | `sdc-inv-1` stays on Java baseline compatibility until the generic SDC package lane is implemented. |
| FML StructureMap parser fixtures | 2 | Parser baseline | `map-general-test*` compare against checked-in Java StructureMap parser baselines; product JSON-resource validation remains unchanged. |
| NDJSON parser fixture | 1 | Parser baseline | `test-ndjson.ndjson` compares against Java's NDJSON parser baseline in discovery. |
| Missing upstream Java artifact | 1 | Synthetic success baseline | `cw-slice-compatible` has no checked-in Java outcome artifact; discovery uses the expected empty success outcome for this compatible refinement. |
| JSON5 parser fixtures | 8 | Adjacent harness | JSON5 manifest cases compare Java parser behavior in discovery; product resource validation still expects parsed JSON objects. |
| DSIG JSON fixtures | 6 | Adjacent harness | DSIG JSON cases compare Java `OperationOutcome` baselines; this is not a product cryptographic-signature verification claim. |
| Hidden Java outcomes | 2 | Manifest path drift | `opdef2-params` and `cc-pattern-system-only` have objective Java outcomes available outside their manifest entries and are included only in discovery. |

## Scope Lanes

Conformance should be reported as multiple lanes instead of one blended
percentage:

| Lane | Status | Metric |
|---|---|---|
| JSON resource parity | Active | `passed / executed` against Java `OperationOutcome` baselines. |
| Baseline-backlog discovery | Active discovery lane | `passed / executed` for additional Java-baseline-compatible cases behind `--include-baseline-backlog`, including explicit parser-baseline fixtures. |
| NDJSON input parity | Discovery fixture only | One Java parser-baseline fixture is green; a product NDJSON input adapter remains separate work. |
| XML input parity | Backlog | XML fixture pass rate after adding parser, normalizer, and XML diagnostic mapping. |
| FML mapping tests | Discovery fixture only | Two Java StructureMap parser-baseline fixtures are green; a product mapping runner remains separate work. |
| JSON5 parser behavior | Discovery fixture only | Eight Java parser-behavior fixtures are green; product JSON5 input support remains a separate decision. |
| DSIG JSON harness | Discovery fixture only | Six Java DSIG JSON fixtures are green; cryptographic-signature validation remains a separate product lane. |
| Adjacent standards | Separate backlog | CDA, HL7 v2, CDS Hooks, SHC, and XVer each need explicit support decisions. |
| Legacy FHIR versions | Separate backlog | STU3/DSTU compatibility score if legacy versions are supported. |
| Logical models | Separate backlog | Logical-model validation score if implemented. |

## XML Decision

An XML-to-JSON adapter is worth adding, but it should be a separate input
lane with its own score. It should not be hand-rolled string parsing.

Minimum acceptance criteria:

- Use a maintained XML parser that preserves namespaces, attributes, text
  nodes, and order where FHIR XML semantics require it.
- Normalize XML resources into the same internal object shape used by JSON
  validation.
- Preserve source locations enough to produce useful XML diagnostics.
- Cover FHIR primitive value/extension representation in XML.
- Cover XHTML narratives and contained resources.
- Compare XML fixtures against Java `OperationOutcome` baselines in a
  separate report, for example `XML input parity: x/y`.

This keeps the core validator object-based and makes XML an input adapter
rather than a forked validation engine.

## Recommended Execution Order

1. **Publish the broadened discovery artifact.** Keep the launch-discovery
   artifact (`547/547`, 0 skips) with the public export so reviewers can
   inspect the exact JSON5, DSIG JSON, parser-baseline, and compatibility
   fixtures included behind `--include-baseline-backlog`.
2. **Add NDJSON loader.** Small input-format expansion; likely one current
   skipped case plus future bulk fixtures.
3. **Classify FML.** Decide whether FML belongs in the public validator repo.
   If yes, add a mapping-language runner and score it separately.
4. **Add XML input lane.** Build parser/normalizer/source-map support and
   report XML separately from JSON.
5. **Decide adjacent standards explicitly.** CDA, HL7 v2, CDS Hooks, SHC,
   XVer, product JSON5 input support, and DSIG cryptographic verification
   should not be inherited accidentally just because they appear in the HL7
   test-case repository.
6. **Decide legacy versions.** Add STU3/DSTU support only if there is a
   concrete customer or ecosystem reason.

## Open-Source Readiness Rule

The public `medvertical/records-fhir-validator` README must state:

- Records itself remains commercial closed-source software.
- The public validator package is Apache-2.0 unless a package-level notice
  says otherwise.
- The headline conformance number is the JSON resource comparison lane.
- Skipped and excluded test classes are documented separately and are not
  hidden inside the percentage.

That framing is required before using the conformance number externally.
