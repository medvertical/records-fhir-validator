# Concept-filter authority fixtures

These are byte-identical HL7 definition metadata, not clinical resources. Runtime selection was measured separately in Loop77 (24 public calls, 86 actual read epochs). The selected IPS CodeSystem is THO 7.1.0, business version 3.0.0; a neighboring package with the same business version is not the selected source. Core 2.9 does not declare hierarchyMeaning and cannot establish a closed complement. Synthetic mutations in tests exercise guards; they are not new upstream editions.

- `ips-contact-codesystem.json` from `packages/bundled-profiles/storage/profiles/bundled/hl7.terminology.r4#7.1.0/package/CodeSystem-v2-0131.json`, SHA-256 `0103e77d97be7645271501b83e8fc0240330ddb822c6f30389a547a3ee2d1959`.
- `ips-contact-valueset.json` from `packages/bundled-profiles/storage/profiles/bundled/hl7.fhir.r4.core#4.0.1/package/ValueSet-patient-contactrelationship.json`, SHA-256 `9b3ef83b85fd67c07afde16c190cea17b616edab6991d9e881bf205101aed0b4`.
- `core-contact-codesystem.json` from `packages/bundled-profiles/storage/profiles/bundled/hl7.fhir.r4.core#4.0.1/package/CodeSystem-v2-0131.json`, SHA-256 `55cd1d12a489abb4f9a77ada66310634faf88acbe667d3f046104f8468240668`.

Primary semantics: https://hl7.org/fhir/R4/codesystem-filter-operator.html and https://hl7.org/fhir/R4/codesystem.html. HL7 FHIR/Terminology materials retain their upstream license.
