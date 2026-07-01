# FHIR Schema Dual-Path Actions

Generated: 2026-07-01T09:53:02.717Z
Source fixtures: 555
Reference cases: 512

| Priority | Bucket | Count | Decision | Next step |
| --- | --- | ---: | --- | --- |
| P2 | local-engines-align-reference-unconfirmed | 25 | Do not change default runtime behavior without explicit product/spec decision. | Review each classification as either intentional stricter product policy or reference/runtime normalization. |
| P2 | graph-only-unconfirmed | 26 | Keep in parallel evidence; do not promote automatically. | Promote only if Java/spec evidence confirms the category or product policy explicitly opts into stricter validation. |
| P3 | graph-aligns-reference-records-missing | 0 | No action: no Java-confirmed Records runtime gap in this report. | Keep as release-gate canary; fail if this bucket becomes non-empty. |
| P3 | records-aligns-reference-graph-missing | 0 | No action: no Java-confirmed graph-only gap in this report. | Keep as graph-promotion gate. |
| P3 | no-reference | 0 | Generate or attach reference evidence before making parity claims for these cases. | Extend Java CLI supplement or repair the MII HTTP reference environment for these fixtures. |
| P3 | profile-missing | 55 | Keep out of parity numerators; this report is the documented scope exclusion set. | Add meta.profile to corpus fixtures where valid, or keep the profile in the documented exclusion set. |

## shared-local-strictness
Priority: P2
Bucket: `local-engines-align-reference-unconfirmed`
Decision: Do not change default runtime behavior without explicit product/spec decision.
Rationale: Both local paths agree, but Java reference evidence does not confirm the comparable key.
Next step: Review each classification as either intentional stricter product policy or reference/runtime normalization.
Issue keys:
- 12x `structure-min|code.coding`
- 5x `pattern|category.coding`
- 4x `structure-min|category`
- 3x `pattern|value.code`
- 1x `structure-min|code.coding.code`
Classifications:
- 12x `local-code-coding-slice-cardinality`
- 5x `local-category-coding-pattern`
- 4x `local-category-cardinality`
- 3x `local-value-code-pattern`
- 1x `local-code-coding-child-cardinality`
Sample fixtures:
- `quality-corpus/r4/profiled/mii-2026/mii-2026-consent-consent-example-mii-consent-einwilligung-1.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-consent-consent-example-mii-consent-einwilligung-2.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-consent-consent-example-mii-consent-einwilligung.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-consent-consent-example-mii-consent-result-type-consent-status.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-abnahme-haemofiltration-einzelmesswerte.json`

## graph-only-strictness
Priority: P2
Bucket: `graph-only-unconfirmed`
Decision: Keep in parallel evidence; do not promote automatically.
Rationale: The FHIR Schema graph is stricter than Records and not confirmed by Java reference evidence.
Next step: Promote only if Java/spec evidence confirms the category or product policy explicitly opts into stricter validation.
Issue keys:
- 14x `structure-min|category.coding`
- 9x `fixed|extension:stellungzurop.value.coding.system`
- 1x `structure-min|identifier:maskierterversichertenidentifer.value`
- 1x `structure-max|code.coding`
- 1x `structure-min|code.coding`
Classifications:
- 14x `category-coding-slice-cardinality`
- 9x `extension-slice-fixed-value`
- 1x `identifier-slice-child-cardinality`
- 1x `code-coding-identity-vs-full-pattern`
- 1x `forbidden-code-coding-slice-cardinality`
- 1x `required-code-coding-slice-cardinality`
Sample fixtures:
- `quality-corpus/r4/profiled/mii-2026/mii-2026-base-patient-patient-mii-exa-person-patient-pseudonymisiert.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-abnahme-haemofiltration-einzelmesswerte.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-ausfuhr-drainage-generisch.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-ausfuhr-fluessigkeit-gesamt.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-ausfuhr-gallenfluessigkeit.json`

## java-confirmed-records-gaps
Priority: P3
Bucket: `graph-aligns-reference-records-missing`
Decision: No action: no Java-confirmed Records runtime gap in this report.
Rationale: This bucket means the schema graph and Java reference agree while Records misses the comparable behavior.
Next step: Keep as release-gate canary; fail if this bucket becomes non-empty.

## java-confirmed-graph-gaps
Priority: P3
Bucket: `records-aligns-reference-graph-missing`
Decision: No action: no Java-confirmed graph-only gap in this report.
Rationale: This bucket means Records and Java agree while the schema graph misses the comparable behavior.
Next step: Keep as graph-promotion gate.

## reference-coverage-gaps
Priority: P3
Bucket: `no-reference`
Decision: Generate or attach reference evidence before making parity claims for these cases.
Rationale: Cases without reference evidence cannot confirm whether local behavior should change.
Next step: Extend Java CLI supplement or repair the MII HTTP reference environment for these fixtures.

## profile-scope-gaps
Priority: P3
Bucket: `profile-missing`
Decision: Keep out of parity numerators; this report is the documented scope exclusion set.
Rationale: No-profile fixtures and intentionally unmapped profiles are corpus/scope issues, not validator runtime failures.
Next step: Add meta.profile to corpus fixtures where valid, or keep the profile in the documented exclusion set.
Classifications:
- 43x `noProfile`
- 12x `intentionallyUnmapped`
Sample fixtures:
- `quality-corpus/r4/profiled/mii-2026/mii-2026-biobank-document-reference-document-reference-kulturprotokoll.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-biobank-document-reference-document-reference-protocol-crisprtp53.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-biobank-service-request-service-request-gewebe-biopsie.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-medikation-procedure-procedure-mii-exa-medikation-procedure-thiotepa.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-device-device-mii-exa-molgen-device-illumina-novaseq.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-device-device-mii-exa-molgen-device-sequencer-2.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-device-device-mii-exa-molgen-device-sequencer-nextseq.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-device-device-mii-exa-molgen-device-sequencer.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-device-device-mii-exa-molgen-device-thermofisher-ionchef.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-document-reference-document-reference-mii-exa-molgen-documentreference-bed-file.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-document-reference-document-reference-mii-exa-molgen-documentreference-fastq.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-media-media-mii-exa-molgen-media-coverage-plot.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-observation-observation-mii-exa-molgen-phenotypic-feature-1.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-observation-observation-mii-exa-molgen-phenotypic-feature-2.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-observation-observation-mii-exa-molgen-phenotypic-feature-3.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-observation-observation-mii-exa-molgen-phenotypic-feature-4.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-patient-patient-mii-exa-molgen-patient-2.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-patient-patient-mii-exa-molgen-patient-brca1.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-patient-patient-mii-exa-molgen-patient-fgfr2-fusion.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-patient-patient-mii-exa-molgen-patient-srcc.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-patient-patient-mii-exa-molgen-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-plan-definition-plan-definition-mii-exa-molgen-protocol-agilent-sureselect.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-practitioner-practitioner-mii-exa-molgen-practitioner-lab.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-practitioner-practitioner-mii-exa-molgen-practitioner-ordering.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-practitioner-practitioner-mii-exa-molgen-practitioner-physician.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-specimen-specimen-mii-exa-molgen-specimen-blood-edta.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-molgen-specimen-specimen-mii-exa-molgen-specimen-dna-library.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-adverse-event-adverse-event-mii-exa-onko-oxaliplatin-neuropathy.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-diagnostic-report-diagnostic-report-patient-kim-musterperson-patho-report-1.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-encounter-encounter-mii-exa-onko-krk-bundle-encounter.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-encounter-encounter-mii-exa-onko-mamma-bundle-encounter.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-encounter-encounter-mii-exa-onko-melanom-bundle-encounter.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-encounter-encounter-mii-exa-onko-prostata-bundle-encounter.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-folfox-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-krk-bundle-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-mamma-bundle-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-melanom-bundle-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-molecular-board-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-mii-exa-onko-prostata-bundle-patient.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-patient-patient-patient-kim-musterperson.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-research-study-research-study-mii-exa-onko-studie-prob.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-service-request-service-request-mii-exa-onko-molecular-surgery-request.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-onkologie-specimen-specimen-patient-kim-musterperson-specimen-1.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-einfuhr-abgepumpte-muttermilch.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-einfuhr-muttermilch.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-einfuhr-oraler-fluessigkeit.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-einfuhr-saeuglingsnahrung.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-bilanz-einfuhr-spendermilch.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-score-rass.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillenbefund.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillenform.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillengroesse.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillenlichtreaktion-direkt.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillenlichtreaktion-indirekt.json`
- `quality-corpus/r4/profiled/mii-2026/mii-2026-icu-observation-mii-exa-icu-untersuchung-pupillensymmetrie.json`
