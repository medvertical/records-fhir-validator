# Declared property equality fixtures

These are unchanged published definition metadata, not clinical resources. Their availability is distinct from runtime selection; public controls register and observe the exact fixture bytes separately. No new UN-M49 authority is manufactured or installed here.

- `ihe-property-codesystem.json`: `.cache/review/parity-plan/mii-closed-metadata-catalog/packages/ihe.formatcode.fhir#1.4.0/package/CodeSystem-formatcode.json`, SHA-256 `e61e69772435687b3bbf67d163c9a9443acd0b40bb236c22bf5a31da7bb28afb`.
- `hl7-format-valueset.json`: `packages/bundled-profiles/storage/profiles/bundled/hl7.terminology.r4#7.1.0/package/ValueSet-v3-HL7FormatCodes.json`, SHA-256 `b604f1c4f0ae0c12d1273b0c32295817ee94cefaa3858597d6bf9b4e8a948320`.
- `uk-property-filter-collision.json`: `packages/bundled-profiles/storage/profiles/bundled/fhir.r4.ukcore.stu3.currentbuild#0.0.6-pre-release/package/CodeSystem-UKCore-PersonMaritalStatus.json`, SHA-256 `53545c29903feb07038867e8afded7834b2ced51f3ccfec61065dcaa629908b4`.
- `participation-property-codesystem.json`: `packages/bundled-profiles/storage/profiles/bundled/hl7.terminology.r4#7.1.0/package/CodeSystem-v3-ParticipationType.json`, SHA-256 `5aa71a6fbcdb453218aad615c12b895704e952efc0bcb8ea393b6d11308e1069`.

IHE formatcode 1.4.0 has `hierarchyMeaning: grouped-by` and no custom filter; property equality does not require `is-a`. The actual HL7 v3-HL7FormatCodes ValueSet 2.1.0 filters its `status = active`; XPHR has active status and two distinct repeated comment values. ParticipationType 6.0.0 declares boolean conductible and actual ADM has false. Comment/boolean filters used in controls are explicitly derived queries; they are not claimed as upstream ValueSet definitions. UKCore's ApplicableCountry has a same-name custom filter, whose semantics remain uninterpreted.

A positive known value establishes existence. Neither complete concept content nor complete property/filter definitions certifies every repeated concept property value; missing/nonmatching facts remain unknown. Synthetic guard/compose mutations are test cases, not upstream releases. Code/string comparisons preserve lexical identity; Coding/numeric/dateTime semantics remain unknown pending their own primary contracts.

Primary semantics: https://hl7.org/fhir/R4/codesystem.html#properties and https://hl7.org/fhir/R4/valueset-definitions.html#ValueSet.compose.include.filter. Published metadata retains upstream licensing.
