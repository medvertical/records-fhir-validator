---
type: product-contract
status: current
owner: validation
audience:
  - integrator
  - developer
  - internal
last_reviewed: 2026-08-21
source: manual
---

# FHIR Conformance Scope Roadmap

**Status:** 2026-07-30
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
| Upstream manifest entries | 969 | All entries in `FHIR/fhir-test-cases/validator/manifest.json` at commit `8923095`. |
| Pre-filtered out | 433 | Not executable by the current JSON resource comparison harness. |
| Candidate comparison set | 536 | R4/R5/R6 or unversioned entries where the upstream manifest declares a `java` baseline. |
| Runtime skipped | 3 | Fixtures needing a SNOMED national edition the public terminology server does not carry. |
| Executed and compared | 533 | Records output was normalized to `OperationOutcome` and diffed against Java. |
| Passed | 531 | Comparisons matching the normalized Java result. |
| Failed | 2 | `bp` and `jv-patient-bad`; see "JSON Lane Re-measurement". |

The previous 2026-05-03 launch-discovery lane is retained as historical
evidence. It was measured against an older manifest and must not be combined
with the current headline result.

The current score should be described as:

> Records matches the Java validator on 531 of the 533 currently in-scope FHIR
> JSON resource validation comparisons.

It should not be described as support for every item in the upstream manifest.

## Why 433 Entries Are Pre-Filtered

| Reason | Count | Decision |
|---|---:|---|
| XML resources | 299 | Scored separately in the XML input lane (`--lane xml`), never folded into the JSON headline. 298 enter the XML lane under the same version, module, baseline, and logical-model filters as JSON; the remaining entry declares no `java` baseline. |
| Non-R4/R5/R6 FHIR versions (`3.0`, `3.0.1`, `1.4`) | 47 | Add only if legacy STU3/DSTU support becomes a product target. |
| Unsupported modules: SHC, CDA, CDS Hooks, JSON5, XVer, DSIG, HL7 v2 | 68 | Adjacent standards need dedicated modules and separate scores. |
| Disabled by upstream manifest (`use-test: false`) | 17 | Keep excluded unless upstream enables them or Records defines its own baseline. |
| No `java` baseline declared in the upstream manifest | 1 | `(default)/zzz` is an upstream platform-specific teardown workaround rather than a validator comparison case. |
| Logical model test | 1 | Add as a logical-model lane if logical-model validation is implemented. |

These are excluded because they do not test the current package contract:
validate a parsed FHIR JSON resource and compare the result with a Java
`OperationOutcome` baseline.

## Executable Parity Lane

The upstream manifest cleanup removed the baseline-resolution gap: every
headline candidate resolves a checked-in Java outcome. 531 of the 533 executed
comparisons match the normalized Java result; the two that do not are recorded
under "JSON Lane Re-measurement" and are open.

| Module | Failed |
|---|---:|---|
| All measured modules | 0 |

The machine-readable case details are in
`conformance-results/report-2026-07-21.json`. Future parity changes must update
the validator or an explicitly justified normalization policy and add focused
regression tests; differences must not be hidden with replacement outcomes.

### Historical Baseline Discovery

`conformance-results/baseline-backlog-discovery-2026-05-03.json` records a
547/547 discovery run against the older manifest. That lane used local path,
parser, and compatibility fixtures behind the legacy
`--include-baseline-backlog` flag. It remains useful as historical provenance,
but its 100.0% result is superseded by the current direct-baseline measurement.

The upstream cleanup now supplies direct outcomes for cases including
`opdef2-params`, `cc-pattern-system-only`, and `cw-slice-compatible`; Records no
longer injects hidden manifest fields, remaps stale outcome paths, or synthesizes
missing Java outcomes in the headline harness.

## Scope Lanes

Conformance should be reported as multiple lanes instead of one blended
percentage:

| Lane | Status | Metric |
|---|---|---|
| JSON resource parity | Active | `passed / executed` against Java `OperationOutcome` baselines. 533/533 on current main with a terminology server, which is how CI gates it; 532/533 without one, the remaining case being a declared exception. The superseded 536/536 is explained under "JSON Lane Re-measurement". |
| Baseline-backlog discovery | Historical | Older opt-in measurement retained for provenance; not part of the current headline claim. |
| NDJSON input parity | No lane — decided | One upstream fixture exists, so no meaningful parity metric is possible. Loader tests cover it instead. See "Scope Decisions". |
| XML input parity | Measured, not publishable | 153/297 executable comparisons (51.5%) against Java `OperationOutcome` baselines. Run with `--lane xml`. Report: `conformance-results/xml-parity-2026-08-24.json`. Not a headline claim until the divergence classes below are closed. |
| FML mapping tests | Out of scope — decided | Two fixtures; a mapping runtime is a different product. See "Scope Decisions". |
| JSON5 parser behavior | Discovery fixture only | Eight Java parser-behavior fixtures are green; product JSON5 input support remains a separate decision. |
| DSIG JSON harness | Discovery fixture only | Six Java DSIG JSON fixtures are green; cryptographic-signature validation remains a separate product lane. |
| Adjacent standards | Out of scope — decided | CDA, HL7 v2, CDS Hooks, SHC, DSIG, JSON5 each need their own corpus and maintenance. XVer was measured (JSON 5/9, XML 1/4) and left open for re-measurement. See "Scope Decisions". |
| Legacy FHIR versions | Out of scope — decided | Admitted only against a named engagement. See "Scope Decisions". |
| Logical models | Separate backlog | Logical-model validation score if implemented. |

## XML Decision

An XML-to-JSON adapter is worth adding, but it should be a separate input
lane with its own score. It should not be hand-rolled string parsing.

Input-adapter acceptance criteria are complete:

- Use a maintained XML parser that preserves namespaces, attributes, text
  nodes, and order where FHIR XML semantics require it.
- Normalize XML resources into the same internal object shape used by JSON
  validation.
- Preserve source locations enough to produce useful XML diagnostics.
- Cover FHIR primitive value/extension representation in XML.
- Cover XHTML narratives and contained resources.
The remaining measurement task is to compare XML fixtures against Java
`OperationOutcome` baselines in a separate report, for example
`XML input parity: x/y`.

This keeps the core validator object-based and makes XML an input adapter
rather than a forked validation engine.

## Recommended Execution Order

1. **Publish the broadened discovery artifact.** Keep the launch-discovery
   artifact (`547/547`, 0 skips) with the public export so reviewers can
   inspect the exact JSON5, DSIG JSON, parser-baseline, and compatibility
   fixtures included behind `--include-baseline-backlog`.
2. **NDJSON loader — complete.** The CLI and public adapter accept bounded
   one-resource-per-line input; a separate parity metric is still required.
3. **Classify FML.** Decide whether FML belongs in the public validator repo.
   If yes, add a mapping-language runner and score it separately.
4. **XML adapter — complete; parity lane measured, not yet publishable.**
   Parser, normalizer, security limits, and source-map support are active, and
   `--lane xml` now scores 298 XML fixtures against Java baselines. The measured
   result is 153/297 (51.5%), so the lane is evidence, not a claim. Closing it
   means working the divergence classes in "XML Lane Divergences" below,
   lowest module score first.
5. **Decide adjacent standards explicitly.** CDA, HL7 v2, CDS Hooks, SHC,
   XVer, product JSON5 input support, and DSIG cryptographic verification
   should not be inherited accidentally just because they appear in the HL7
   test-case repository.
6. **Decide legacy versions.** Add STU3/DSTU support only if there is a
   concrete customer or ecosystem reason.

## JSON Lane Re-measurement

The published headline is 536/536, measured 2026-07-23. On current main against
`https://tx-dev.fhir.org/r4` the lane reports **533 passed, 0 failed, 3 skipped
of 536 selected** — 533/533, 100.0%.

Getting there was not a matter of restoring the old number. Two of the original
536 were false passes, both JSON resources whose profile source is an XML file
that the harness could not read; correcting that dropped the lane to 531/533,
and the two cases were then fixed on their merits — a warning-severity profile
constraint that was being demoted to information, and a pinned ValueSet version
silently satisfied by a same-major fallback. The three skips are fixtures
needing a SNOMED national edition the public terminology server does not
carry. They are classified, not silent.

The two failures were false passes:

| Case | Profile source | Why it passed before |
|---|---|---|
| `bp` | `bp-profile.xml` | Profile never loaded; validated against the base spec. |
| `jv-patient-bad` | `jv-patient-profile-res.xml` | Same. |

Both are **JSON** resources whose profile source is an **XML** file. The harness
read every profile source with `JSON.parse`, so the parse threw, the profile was
skipped, the resource was validated against the base spec, found little, and
scored above threshold. They passed because validation did not happen.

`ips-nz-pj`, which failed during this work, is not one of them: it compares
LOINC display names and needs a terminology server. It passes with one. The
README told readers to reproduce the headline with `--tx-server none`, which
cannot reproduce it; that instruction is corrected.

Two consequences:

1. The 536/536 headline must not be quoted again. The reproducible number on
   current main is 533/533 with the terminology server configured, re-measured
   2026-08-25. Without one it is 532/533: `ips-nz-pj` then disagrees, which is a
   declared `intentionalRegressions` entry, not an open defect. Quote the
   terminology-server number and say so, because that is the configuration the
   weekly gate runs.
2. A silent read failure counted as agreement — the same defect class as the XML
   lane's initial 51.5%. Any lane that resolves fixtures by file extension
   should be audited for it.

### What "533/533" does and does not mean

Measured 2026-08-25 against a terminology server, 533 of 533 executed
comparisons clear the parity threshold. They do not all agree. The comparison
scores structural similarity against the Java `OperationOutcome` and passes a
case at 0.70. Of the 533:

| | Cases |
|---|---|
| Reproduce the Java baseline exactly (score 1.000) | 515 |
| Clear the threshold with a residual difference (0.717–0.895) | 18 |

The distribution is bimodal — nothing scores between 0.895 and 1.000. A case
either matches the baseline or differs materially; there is no gradual tail.

Fifteen of the 18 agree on every error and differ only in warnings or
informational findings. Three disagree on error counts:

| Case | Records / Java errors | What it is |
|---|---|---|
| `bundle-enrl` | 64 / 68 | Message granularity plus one deliberate divergence. The reference emits two issues per unresolvable profile where Records emits fewer, so most of the gap is decomposition, not a missed finding. The remaining one is `Unknown code 'E10.3211+TT1.2'` in ICD-10-CM: `EXTERNAL_CODE_SYSTEMS` excludes ICD and CPT on purpose, because public terminology servers carry incomplete licensed content and report valid codes as unknown. Records declines to assert membership there. |
| `ips-nz-pj` | 3 / 4 | The declared `intentionalRegressions` entry. Verified correct: the server accepts `'Vital signs'` for `8716-3` and Records follows it; the vendored baseline is stale on that code. |
| `ips-link` | 3 / 4 | Not a miss. Records reports the same wrong-display finding as a warning where the reference reports an error — and reports the identical finding as an error in `ips-nz-pj`. |

Counting errors per case also hides the opposite direction. At path level across
these 18, the reference reports 48 findings Records does not, and **Records
reports 12 the reference does not**. One of those twelve was checked and was
wrong: Records rejected `'Moderate'` as the display for SNOMED `6736007`, which
`$validate-code` accepts. A false finding on valid data is worse for a
validation product than a missed one, and per-case error totals made it
invisible. That entry is fixed; the other eleven have not been checked
individually.

This started at 20 residual-difference cases and 9 missing errors. Three closed
on 2026-08-25: two from a German LOINC designation that the table accepted and
the server rejects, one from a `Bundle.link` paging relation that had no rule at
all. Of the six that remain, five are accounted for — message decomposition in
`bundle-enrl`, the verified stale baseline in `ips-nz-pj`, and the deliberate
ICD non-assertion.

**One genuine defect is open.** A wrong-display finding takes its severity from
whichever of two code paths produced it: the table path in
`terminology-display-rules.ts` hard-codes `error`, while the binding path in
`valueset-display-utils.ts` derives it from binding strength — `required` gives
`error`, `preferred` gives `information`, everything else `warning`. The same
finding on the same LOINC code therefore surfaces as an error in `ips-nz-pj` and
a warning in `ips-link`. The reference validator reports both as errors.

Records disagreeing with itself is the defect; which severity is right is a
separate question. Whether a display that matches no designation should depend
on binding strength at all is a product decision, not a conformance one — the
binding governs which codes are allowed, not whether a display matches the code
system. Deciding it changes MII output as well as this lane, so it needs its own
measured change rather than being folded into a parity fix.

### The display-severity split: attempted, measured, reverted

`ips-link` disagrees with the reference only in severity — Records reports the
same wrong-display finding as a warning there and as an error in `ips-nz-pj`.
Unifying that was attempted on 2026-08-25 and reverted. What the attempt found
is worth more than the change was.

**There are three producers of `terminology-display-mismatch`, with three
different severity rules:**

| Producer | Severity |
|---|---|
| `terminology-display-rules.ts` (hard-coded designation tables) | `error`, with a comment citing the Java baselines |
| `terminology-code-system-result-issues.ts` (the terminology server's own verdict) | `warning` |
| `valueset-display-validator.ts` (binding path) | derived from binding strength |

The registered default for the code is `warning` while two of the three override
it. The middle row is the striking one: the server is asked, answers
`severity: "error"`, and Records downgrades it. That is deliberate — two tests
were named for it ("keeps global CodeSystem display hygiene as a warning",
"keeps coded value display mismatches as warnings") — on the view that a wrong
display is cosmetic because the code itself is valid.

**Records double-reports this finding.** The table path emits it at the
resource-qualified path (`Bundle.entry[4].resource/*Practitioner/…*/.identifier[0]…`)
and the server path at the unqualified one (`Bundle.entry[4].resource.identifier[0]…`).
Dedupe normalises the qualifier away, so the two rows differ only by severity —
which is exactly why both survive today. Customers see the same finding twice,
once as an error and once as a warning. This is a defect independent of the
severity question and should be fixed on its own.

**What the measurement said.** Unifying on `error`:

- `ips-link` 0.895 → **1.000**, exact agreement with the reference
- `bundle-enrl` 0.721 → **0.697**, crossing the 0.70 threshold, so the case fails
  and the lane drops to 532/533
- overall similarity 99.3% → 99.4%, exact reproductions 515 → 516

The duplicate collapses once the severities match, but dedupe keeps whichever
row came first — the unqualified path, which is not the spelling the reference
emits, so `pathOverlap` falls. Making dedupe prefer the qualified path was tried
and changed nothing measurable. Making the binding path severity-independent
changed nothing measurable either: no fixture in either lane exercises it.

MII was unaffected throughout — 231/231, parity 100.0%, measured against the
reference container before and after.

**Why it was reverted rather than landed.** One case gained, one case broke, and
the broken one takes the headline below 533/533. Declaring `bundle-enrl` an
intentional regression would be managing the number rather than the defect,
which is the failure this document exists to record. It is also a breaking
change for anyone gating on error severity.

Landing it needs the duplicate fixed first — one producer, one path spelling,
one severity — and then a deliberate decision on what that severity is, with the
policy in an explicit strictness setting rather than in the binding. That is a
design pass, not a parity patch.

### ele-1 and ref-1 are evaluated by nobody on the single-resource path

Found 2026-08-25 while chasing why an ele-1 finding never reached a report.

`invariant-registry.ts` records `ele-1` and `ref-1` as owned by
`universal-constraints-validator.ts`, and `constraint-validation-pipeline.ts`
excludes both from the generic FHIRPath executor on that basis, so they are not
double-reported. But the owner is only wired into
`multi-aspect-aspect-execution.ts` — the batch path. The single-resource path
calls `runAllAspectValidations` with a fixed executor list that does not include
it, and `validate()` takes that path. So does the conformance harness, and so,
on the same entry point, do the CLI and the plugin.

The registry's own header warns about exactly this: *"Miss one and you either
silently double-report the constraint or silently skip it, depending which code
path fires."* It is silently skipping, and has been for an unknown length of
time.

**Wiring it in was tried and measured, then reverted.** With the owner called
from the single-resource path:

| | Before | After |
|---|---|---|
| XML lane | 161/293 (54.9%) | **163/293 (55.6%)** |
| XML similarity | 69.1% | 69.5% |
| JSON lane | 533/533 | **532/533** |

Four XML cases improve, two of them to passing — `patient-id-only` reaches exact
agreement at 1.000 and `japanese-utf8-ok` passes. Two false positives appeared
and were fixed on their merits (extensions belong to ext-1; narrative is not
FHIR elements), and those fixes are committed.

One JSON case blocks it. `bundle-ea-testcase` drops from 0.737 to 0.661 in the
full lane — but only there. Run alone it reports twelve errors instead of the
lane's fourteen, and run with just its own module it *passes* at 0.764, better
than before the change. So the regression needs both the change and
cross-module state, and that state dependency is a second defect worth its own
look: a case whose result depends on what ran before it is not measuring the
validator.

Reverted rather than landed, for the same reason as the display-severity
attempt: the JSON headline is the published number and this would take it to
532/533 for a reason nobody can yet explain. The finding stands and the fix is
worth landing once the interaction is understood.

### Cross-case state: measured, and it does not inflate the numbers

A case failed in the full lane and passed in its own module, which raised the
question of whether the parity numbers depend on execution order. They do, a
little, and not in the direction that would have been damaging.

The mechanism is real. `registerExternalProfile` on the SD loader has no
counterpart — nothing unregisters or clears external profiles — and between
cases the harness evicts only the current case's own profile URL, which its own
comment states. 237 of 969 manifest entries carry supporting resources, so every
StructureDefinition any case registers stays resolvable for the rest of the run.

Measured by adding `clearExternalProfiles()` to the loader — it drops only
externally registered profiles and leaves bundled content untouched — and
calling it before each case loads its own supporting files:

| | Normal | Per-case isolation |
|---|---|---|
| JSON | 533/533, similarity 99.3% | **533/533, similarity 99.4%** |
| XML | 161/293, similarity 69.1% | **162/293, similarity 69.4%** |
| Cases scoring worse | | **none** |
| Cases scoring better | | three |

So accumulated profiles were not propping the numbers up. `bundle-ea-testcase`
rises from 0.737 to 0.764, `patient-id-only` from 0.340 to exact 1.000, and
`group-choice-empty` from 0.340 to 0.500. Everything else is unchanged.

An earlier reading of this — that the lane benefited from contamination —
was wrong. It came from comparing a full-lane result against a module-only
triage run in which the case never received its own supporting resources. That
is an artefact of the comparison, not of the lane.

Two things follow. Isolation is the correct default on its own merits: a case
should see what it supplies and nothing else, and it costs nothing here. And it
unblocks the `ele-1`/`ref-1` wiring described above, whose only blocker was
`bundle-ea-testcase` — the same case isolation repairs.

### What the two failures now need

`jv-patient-bad` reaches its finding: the `min-digits-sor` constraint from the
child's datatype profile now fires, because slice discriminator evidence is
merged from profiles named on a slice child's `type.profile`. It still diverges
on severity — the profile declares `warning`, Records emits `information` — and
on issue path. Only cardinality is deliberately not merged from a child's
datatype profile; carrying it across produced spurious "too few values" errors.

`bp` is the last JSON failure and is now diagnosed. The slice-match information
it needed is implemented (`profile-slice-open-unmatched`). What remains are three
warnings of the form `ValueSet 'http://hl7.org/fhir/ValueSet/observation-status|4.0.0'
not found`.

The canonicals are pinned to `4.0.0` while the bundled core package publishes
them at `4.0.1`. The reference validator treats the pinned version as an exact
requirement and warns when it cannot resolve it; Records resolves the canonical
without regard to the version, finds `4.0.1`, and stays silent.

Two separate gaps sit behind that, and only the first was closed by
experiment — the second is what actually blocks the case:

1. Availability was only checked when the element carried no code
   (`codeInfos.length === 0`). Adding the check for coded elements changes
   nothing here, which is how the second gap was isolated.
2. Canonical resolution ignores a pinned `|version`. Making it version-aware
   would emit warnings on every profile that pins a version the local package
   set does not match exactly, so it needs its own measured change rather than
   being folded into unrelated work.

## XML Lane Divergences

Current measurement (2026-08-24, `--lane xml --tx-server https://tx-dev.fhir.org/r4`,
fhir-test-cases commit `8923095`): 298 candidates, 297 executed, **153 passed,
144 failed** (51.5%), 1 runtime skip. Similarity 67.8%.

How it got here, because the intermediate numbers are misleading on their own:

| Run | Result | What changed |
|---|---|---|
| First | 153/297 (51.5%) | Inflated. XML supporting files and profile sources were read with `JSON.parse`, so profiles silently failed to load and cases passed because Records found nothing. |
| After reading XML profiles | 100/297 (33.7%) | Honest but broken. Loading the profiles exposed that the converter produced unusable shapes for them. |
| After schema-driven conversion | 145/297 (48.8%) | Converter defect closed. |
| With terminology server | 152/297 (51.2%) | Terminology was a small lever: +7 cases, not the large block the class counts suggested. |

### Closed: the converter defect

`fhir-xml-node-converter.ts` decided primitive types and cardinality from
hardcoded element-name tables. `Quantity.value` produced a string because the
table keyed on type names while the XML parent of a choice is spelled
`valueQuantity`; single-occurrence repeating elements became scalars because
`isRepeatingElement` was a fixed pair list, which is why
`StructureDefinition.differential.element` converted into something unusable.
Both now resolve against generated base-StructureDefinition tables, per
release. See `scripts/codegen/generate-fhir-xml-type-table.ts`.

### Remaining: under-detection, not conversion

The direction of the remaining 145 failures is the useful signal, and it moved:

| Direction | Before converter fix | Now |
|---|---:|---:|
| Records reports fewer errors than Java | 58 | **104** |
| Records reports more errors than Java | 49 | 19 |
| Equal counts, other divergence | 37 | 22 |

Records now converts and validates these resources without emitting noise; it
simply does not find what the reference validator finds. The work left is
validation coverage on these resource shapes, not input handling. Module scores
locate it: `sd` (25.0%), `logical` (25.0%), `measure` (28.6%),
`questionnaire` (33.3%) against `general` (64.6%) and `xhtml` (64.0%).

Two classes are known and separate from that:

- **XML-representation violations (8 cases).** Stray element text and unknown
  attributes are dropped during conversion, so an object-based validator cannot
  see them. Java reports them. Either the adapter emits diagnostics while
  parsing, or these fixtures are declared out of scope explicitly rather than
  counted as failures.
- **Message template placeholders (2 cases).** `{error}` / `{message}` reach
  output unsubstituted. Not XML-specific — it also occurs in the passing JSON
  lane — and worth fixing independently.

Lowercase element names in diff output (`typetested.handling.max`) are an
artifact of `outcome-diff-paths.ts` normalizing both sides before comparison.

### Diagnosed and open

**Snapshot generation resolves a base profile without a FHIR release.**
`SnapshotGenerator.loadBaseProfile(profileSD.baseDefinition)` takes no version,
so a profile validated in the R5 lane inherits the R4 base. The aggregation
fixtures show it: `Encounter.class` is `1..1` in R4 and `0..*` in R5, and
Records reports it missing on R5 cases where the reference validator does not.
Base validation is version-correct on its own — the same Encounter gives an
error under R4 and only a best-practice notice under R5 — so the defect is
confined to the profile-driven path. Fixing it means threading the release
through `SnapshotGenerationOptions` into base resolution and every caller,
which changes which base profile is used across all profile-driven validation
and needs its own measured pass. Affects 5 cases.

**Versioned ValueSet canonicals** now report when a pinned version was not the
one resolved. The same-major fallback stays — it keeps validation working — but
the substitution is no longer silent. This closed `bp`, the last JSON lane
failure.

**Fixed-value checking against a profile** is absent in 6 cases: the reference
validator reports `Value is X but is fixed to Y in the profile`.

**Core element invariants (`ele-1` and siblings)** go unevaluated in 4 cases.

**Reference aggregation is not checked at all.**
`ElementDefinition.type.aggregation` restricts how a reference may reach its
target — contained, bundled, or referenced — and nothing in the validator reads
it. Six fixtures depend on it (`aggregation-apart-*`, `aggregation-bundle-*`).

The rule is simple; the placement is not. `ReferenceTargetValidator` looks like
the natural home but only runs when
`settings.recursiveReferenceValidation.validateTargetProfiles` is set, which the
conformance lane does not set. `deep-profile-validator` does run, but a check
placed there never fired for these fixtures, so the element carrying the
aggregation is not reaching that walk. Closing this means first establishing
which path sees a materialised profile element for an external differential-only
profile — the same question behind the snapshot base-resolution fix.

### Before this lane can carry a published number

1. Work the under-detection classes, lowest module score first. This is now the
   whole job.
2. Decide the representation-level class explicitly: adapter diagnostics, or
   documented exclusion.
3. Fix `{error}` / `{message}` substitution.

Reproduce with `npm run conformance:xml`. Full outcomes for analysis:
`tsx scripts/conformance/triage-xml-lane.ts <out.json> xml`.

## Terminology Endpoint Must Match the Release

A terminology server answers for one FHIR release. Both lanes were run entirely
against `https://tx-dev.fhir.org/r4`, so every R5 fixture asked an R4 endpoint
about codes it has never heard of. `5.0.0` is not in the R4
`ValueSet/FHIR-version`, and the miss was reported as though the resource were
wrong.

Cases are now grouped by the release the manifest declares and each group is
asked of the matching endpoint. The runner rewrites a trailing `/r4`-style
release segment and leaves any other server untouched, since guessing at an
unfamiliar layout would be worse than using what was configured.

This removed a fixture normalisation rather than needing another one:
`mixed-request-canonical-targets-profile` had a hand-written rule discarding
Records' `5.0.0` finding. With the endpoint corrected the finding never occurs
and the rule is deleted.

## Scope Decisions (2026-08-24)

The lanes below were "staged" without anyone deciding them. Each is now decided
from the fixture counts rather than from intent, because a lane is a commitment:
every published number has to be maintained, re-measured, and defended.

### NDJSON — no parity lane

The upstream manifest contains **one** NDJSON fixture. "NDJSON input parity:
1/1" would imply a breadth that does not exist. The adapter is covered by its
own loader tests (bounds, per-line errors, record limits) and the README states
that NDJSON is a bounded input adapter over the same JSON validation path, with
no separate parity claim. The earlier plan to "publish a separate NDJSON lane"
is withdrawn: there is no corpus to publish against.

### FML — out of scope

Two fixtures, and FHIR Mapping Language is a transformation engine rather than
a validator. Supporting it means maintaining a mapping runtime, which is a
different product. The two green parser-baseline fixtures stay discovery
artifacts and are not a product signal.

### Adjacent standards — out of scope, except XVer which was measured

CDA (5), HL7 v2 (4), CDS Hooks (20), SHC (11), DSIG (8), and JSON5 (8) each
need their own corpus, number, and maintenance. They are separate validators,
not extensions of this one.

XVer is different: cross-version extensions are core FHIR, and the engine
already touches them — 0.6.0 aligned severities for cross-version extension
URLs. It was measured rather than assumed:

| Lane | Result |
|---|---|
| JSON | 5/9 |
| XML | 1/4 |

Partially handled, far from parity. Not a publishable lane today, and not
excluded on principle either — it is the one adjacent module where a future
decision should be re-measured rather than inherited. Run it with
`CONFORMANCE_EVALUATE_MODULES=xver`.

### Legacy STU3/DSTU — out of scope until a named engagement asks

47 manifest entries. MII, ISiK, and gematik are R4; EHDS targets R4/R5. The
cost of admitting STU3 is a second compatibility score maintained indefinitely.

### Bundled profiles — policy applied, outreach outstanding

The blocker was described as a pending licence review. The review existed but
covered 5 packages while `prepack.mjs` would have shipped 43. Applying the
package's own documented rule leaves 29 shipping and 11 excluded, plus
`loinc.cache` removed as LOINC-licensed cached content. See
`packages/bundled-profiles/THIRD_PARTY_NOTICES.md`.

What remains is not engineering: most excluded packages are German IGs a DACH
user would want offline, excluded on missing metadata rather than any known
restriction, several published by personal Simplifier accounts rather than the
issuing organisation. Re-including them needs licence statements from those
publishers.

## Open-Source Readiness Rule

The public `medvertical/records-fhir-validator` README must state:

- Records itself remains commercial closed-source software.
- The public validator package is Apache-2.0 unless a package-level notice
  says otherwise.
- The headline conformance number is the JSON resource comparison lane.
- Skipped and excluded test classes are documented separately and are not
  hidden inside the percentage.

That framing is required before using the conformance number externally.
