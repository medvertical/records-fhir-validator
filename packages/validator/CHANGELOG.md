# Changelog

All notable changes to `@records-fhir/validator` are documented in this
file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The companion `@records-fhir/validation-types` and
`@records-fhir/bundled-profiles` packages share this changelog when they
ship together; package-only changes are noted under each release.

## [Unreleased]

## [0.8.0] — 2026-10-05

This release consolidates the unpublished 0.7.1–0.7.5 development series
and aligns many checks with the HL7 reference validator, found by comparing
both on 60 public-server and implementation-guide corpora. Several defaults
change with it, each described under Changed: targets carried in a Bundle,
contained or Parameters are held to their targetProfiles, a display the code
system confirms wrong is an error, and invariants on nested elements are
evaluated at the element.
It ships with `@records-fhir/validation-types` 0.1.13.

The public-corpus comparisons guided development; they do not certify complete
issue parity. Release review replaced path-only and broad issue-bucket matching
with explicit semantic equivalences. Re-comparing the saved 60-corpus outputs
(24,429 resources) retains exact error agreement for 16,667 resources, compared
with 23,073 under the old matcher. The 6,406 newly unmatched resources require
triage; they are not a count of confirmed validator defects. These are historical
outputs, not a fresh measurement of this release candidate.

### Added

- Added a separate R4 JSON conformance acceptance gate that authenticates fresh built-SDK measurements and recomputes reference-output, unknown-terminology and definition-conflict contracts. Raw outcomes, scores, statuses and unknown membership remain independently visible; missing, stale, inconsistent or unsupported evidence fails closed.
- Made conformance-harness issue identities deterministic so original SDK receipts reproduce complete normalized outcomes without time-dependent metadata changes.

- Import explicitly pinned FHIRsmith LOINC/SNOMED datasets into scoped FHIR CodeSystem inputs with source/output integrity manifests. Complete own descriptions preserve source languages and inactive labels; the declared provider contract supports base-language display checks without applying that policy to unrelated CodeSystems. Selected code lists and SNOMED projections remain fragments, with missing codes and unsupported filters reported as unverified.
- Allow RecordsValidator instances to supply local ValueSet/CodeSystem package directories independently of other runtimes. An explicit empty list closes default filesystem stores; omitted configuration preserves existing stores. Constructor configuration is copied, while scoped tenant host resources and explicitly registered terminology retain their existing precedence. This does not close other profile, pinning or rule-metadata sources.
- Record case-bound native MII StructureDefinition, ValueSet and CodeSystem lookup selections, misses and exceptions without retaining clinical inputs. The strict reader verifies selected definition bytes and metadata; the launcher hashes its own Java agent and verifies both observed worker-context classes. Repeated external requests remain separate, while identical adjacent overload delegation is omitted. This establishes observation evidence only, not terminology or Records parity completeness.
- Bind observed MII definition contexts to case, input and SDK parameter identities. Preserve every usage, same-version content variant, unknown origin and captured lookup result; refuse unobserved or ambiguous static selections instead of choosing a default by load order. Context construction remains distinct from a complete Records replay or parity measurement.
- Add a pinned offline native MII definition observer and strict case evidence
  reader. Preserve requested profile versions, input/parameter hashes, definition
  identity and occurrence counts without persisting input payloads. Observer
  controls retain the initialized worker context and compare complete issue
  arrays against the unmodified official CLI; execution return does not imply
  full terminology or conformance coverage.
- Add a pinned native SDK converter and strict evidence reader for the MII worker context's observed nonclinical definitions. R4 conversion preserves original canonical/version identities, retains same-version content variants by source hash, and requires an exact SDK model roundtrip. Execution, blob inventories and case-trace hashes remain separate from clinical completeness and parity claims.

- Hold a CapabilityStatement search parameter that names its SearchParameter
  definition to that definition's type, when a local package holds it.
- Check ConceptMap source and target codes against their CodeSystems, read
  from the local packages: a code a complete CodeSystem does not define fails,
  a wrong display warns, and a group without source or target system, or with
  one only a terminology server holds, says its codes go unchecked.
- Answer FHIRPath `conformsTo()` by validating the resource against the
  profile, as the reference validator does, instead of reading only its
  declared profiles. CH EPR's invariants that require conformance to the IHE
  MHD and mCSD profiles now hold for conformant resources.
- Check where a cross-version extension without an installed definition is
  used, as the reference validator does: its url names an element of
  another FHIR release (`extension-AuditEvent.agent.network.type`), which
  belongs on that element's parent. A mismatch is a warning, since contexts
  may be renamed between releases.
- Warn when a Coding uses a concept its CodeSystem marks deprecated
  (`status` `deprecated`, or the legacy `deprecated` flag), as the reference
  validator does: v2-0078 interpretation codes, `organization-type#other`.
  A `deprecationDate` alone does not count, so a stored result does not
  change as time passes.
- Report a primitive written as an empty string (`"text": ""`) as
  "value cannot be empty" and as an `ele-1` violation, unless extensions in
  its sidecar carry it.
- Warn, as the reference validator does, when a ValueSet expansion page
  holds more concepts, nested ones included, than its `offset` and stated
  `total` leave room for.
- Hold any uri or url naming an HL7 identifier system (`http://hl7.org/fhir/sid/…`)
  to the systems HL7 Terminology registers, as `Identifier.system` already is:
  the reference validator resolves every URL in HL7's space.
- Validate a resource against the profiles its profile imposes through
  `structuredefinition-imposeProfile`, beside the applied profile (Finland's
  Kanta document metadata profile), in the release the imposing IG depends
  on rather than the newest one installed (CH Lab Report imposes EU
  Laboratory 0.1.1).
- Warn, as the reference validator does, when a system uri points into the
  resource (`#migrated-from`) but no element id or narrative anchor of the
  resource carries that id; in a ValueSet include or exclude, whose system
  has to resolve, this is an error.
- Check Measure structure the way the reference validator does: warn about a
  Measure without groups, a group without population, and a group,
  population or stratifier without code among several; fail CQL stratifier
  criteria of a Measure that names no Library.
- Warn, as the reference validator does, when a narrative uses the same
  node id or `<a name>` anchor more than once, listing each with its count.
- Check where narrative XHTML elements stand, as the reference validator
  does: list items in lists, rows and cells in tables, no blocks inside
  paragraphs, no nested phrase elements and no children of empty elements
  (`narrative-invalid-nesting`).
- Report an HTML named entity such as `&trade;` or `&nbsp;` in a narrative
  (`Invalid entity in the XHTML`), as the reference validator does: FHIR
  parses narrative XHTML as XML without the XHTML DTD, which defines only
  `&amp;`, `&lt;`, `&gt;`, `&quot;` and `&apos;`. Numeric character
  references remain valid.
- Check that a narrative image drawn from inside the resource
  (`<img src="#id">`) names an id the resource carries: a contained resource,
  an element, or an element of one of its narratives.
- Reject a narrative link or image URL that is empty or holds a character
  no URL may contain (a space, `"`, `<`, `{` …), as the reference validator
  does for `<a href>` and `<img src>`.
- Validate a QuestionnaireResponse against a Questionnaire an installed IG
  package ships, as the reference validator does, when the host has no copy:
  from the package itself or, by the id its canonical ends in, from the
  package's examples.
- Warn when a declared profile only resolves through a known alias, such as
  US Core's misspelt `us-core-Coverage`. Records still validates against the
  profile the alias means, but no published profile carries the declared url.
- Check where a Questionnaire item's enableWhen points, as the reference
  validator does: a missing, unknown, own or inner target is an error, and a
  target further down the questionnaire draws a warning.
- Warn about a QuestionnaireResponse authored outside its questionnaire's
  effective period, as the reference validator does.
- Check QuestionnaireResponse items level by level against the questionnaire,
  as the reference validator does: an item the questionnaire defines on
  another level is "in the wrong place", items follow the questionnaire's
  order, a non-repeating item occurs only once, and an unknown linkId is
  reported at the level that holds it.
- Report a QuestionnaireResponse item whose text differs from the text of its
  question, as the reference validator does ("If text exists, it must match
  the questionnaire definition").
- Hold the children of a slice, nested slices included, to their maximum
  cardinality (KBV's Mutterpass allows one entry in
  section:Epikrise.section:Schwangerschaft).
- Report a uri or url in HL7's space that no installed definition carries
  ("No definition could be found for URL value"), as the reference validator
  does, where the owner — the core specification, HL7 Terminology or the IG
  whose canonical the URL extends — is installed (US Core's example map
  names the IG itself as its mapping target). Definitions count as the
  reference validator loads them: conformance resources and examples of a
  package, the exact or major.minor version asked for, fragments ignored;
  extension values are checked except in textLink, web-source and
  ig-page-name.
- Accept only absolute URIs as codes of `urn:ietf:rfc:3986`, which the
  reference validator knows without a CodeSystem definition.
- Require a full URI as the value of an identifier in the
  `urn:ietf:rfc:3986` system, as the reference validator does: a bare OID
  such as `2.16.840.1.113883.19.5` needs its `urn:oid:` prefix.
- Reject a `urn:uuid:` value that holds no lowercase UUID in any uri or
  canonical element, `Bundle.entry.fullUrl` included, as the reference
  validator does (`urn:uuid:questionnaire`).
- Reject a cross-version extension URL naming a FHIR release that has no
  cross-version definitions (`http://hl7.org/fhir/6.0/…`, `…/4.3/…`), as the
  reference validator does, instead of accepting it as known.

### Changed

- Exported validator repositories now expose a pinned workspace-source test command and an explicit test-scope record. Portable synthetic contracts cover Quantity bindings, filesystem lookup, issue anchors and expression-cache behavior; original corpus/profile assertions stay in the monorepo profile lane, and the real corpus cache benchmark has a dedicated command with non-empty execution checks.
- Added independent conformance review contracts for declared reference output limits, input-owned unverified terminology occurrences, and explicit ValueSet definition conflicts. The review preserves original outcomes, severity, raw similarity scores and release gates; unknown membership remains unknown.

- Allow explicitly configured default CodeSystem versions for unversioned code requests while preserving explicit Coding.version, scoped terminology authority and configuration cache isolation.
- Reuse the verified immutable named-inventory index for concept equality and display lookup, while reinterpreting mutable caller inputs.
- Omit a redundant display-unverified warning only when the selected named inventory authoritatively rejects that code in the exact source scope and edition; preserve independent binding incompleteness.
- Restore slice ownership for legacy datatype child IDs in prebuilt snapshots, preserving slice-specific and genuinely unsliced cardinality constraints.
- Load the CLI validation engine only when a resource actually needs validation, keeping help, usage errors and malformed-input reporting fast.
- Correct the duplicated business version in one MII Laboratory example profile claim; preserve its clinical content and genuine terminology incompleteness.

- Keep the public parity comparator regression test with its tooling owner, so exported validator tests no longer import an unavailable monorepo script. The test body and its three expectations are unchanged.

- Correct eleven upstream ICU example profile declarations to their actual ICU 2026.0.2 canonical URLs in the explicitly approved MII corpus revision. Preserve all other fixture bytes, case counts, exclusions and validation policy; document the bounded Medication release exception separately from unchanged raw comparison results and genuine terminology incompleteness.

- Decide a profile discriminator that traverses `resolve()` by validating the
  resource the reference names against the slice's target profiles, as the
  reference validator does: a CH Lab-Order Composition whose ServiceRequest
  entry fails the ServiceRequest profile now misses its required
  `section.entry:ServiceRequest` slice. Verdicts are kept per slice and
  profiles, so two slicings naming a slice alike no longer share one.
- Update the shared HL7/HAPI reference validator and optional Java runtime to 6.10.4 with its official SHA-256 digest, and adapt the streaming bridge to its required renderer factory. Disable HAPI's Jansi/Logback appender before reading clinical input so upstream progress cannot corrupt the JSON-only result channel. Fresh parity evidence records the reference executable, built runtime, inputs and package contents; missing reference profiles and unmatched findings remain visible. Reclassify three HAPI-confirmed invalid MII examples as negative fixtures instead of clean precision samples.
- Parity comparisons reject equivalent-rule pairs with explicit contradictory collection indices. The collection-index guard keeps quoted text, comments and function arguments opaque and stops at unterminated quoted tokens. This changes comparison evidence; resource-context extraction remains a separate scope.
- Treat the reference SDK's explicit `Terminology_TX_Binding_NoSource` finding as diagnostically incomplete in MII comparisons. Preserve original findings, severity and clinical verdicts; an example binding without a ValueSet does not imply a conformance violation.

- Apply `bestPracticeSeverity` to every best-practice finding — dom-6's
  narrative, including dom-6 from profile constraints, and the Observation
  and Patient recommendations. `'warning'` reports them as the reference
  validator does; the default stays `'info'`, so datasets without narratives
  keep their quality scores, and strict mode still escalates dom-6 to an
  error.
- Report a display the code system confirms wrong as an error, as the
  reference validator does, whatever the binding strength and whether a
  local CodeSystem or the terminology server decided it; a server asked to
  report displays as warnings keeps its severity. A display that cannot be
  checked offline stays a warning.
- Check narrative XHTML against the reference validator's element and
  attribute lists: the deprecated `u`, `s` and `strike` and the change marks
  `ins` and `del` are rejected, `address`, `bdo`, `map` and `area` are
  accepted, names are case-sensitive, and an empty element such as `<br>`
  must close itself.
- Report `htmlChecks()` failures of the `rendering-xhtml` extension
  (`xhtml-ext-1`) on primitive values such as `Questionnaire.item.text`; the
  findings were dropped because they carried no constraint key.
- Evaluate an invariant on a nested element at that element even when its
  expression starts with the resource name, as FHIRPath and the reference
  validator do: the leading name filters the element, so on
  `ExplanationOfBenefit.item.productOrService` the name `ExplanationOfBenefit`
  selects nothing. CARIN Blue Button's EOB-vision invariants no longer fail
  where the reference validator passes them, and an invariant such as
  `Patient.active = true` on `Patient.name` fails at every name, as it does
  there.
- Place a resource by a profile discriminator the way the reference validator
  does, by validating it against each slice's profile of its type
  (`conformsTo()`), not by what its meta.profile declares: an IPS Bundle
  whose Composition fails the IPS Composition profile now misses its required
  composition slice, as the reference validator reports. Where a slice's
  profile cannot be read or validated, the existing approximations decide.
- Report instance URLs that point at `example.org` or `acme.com` as errors
  ("Example URLs are not allowed in this context"), in every uri, url and
  canonical element including `Extension.url`, as the HL7 reference validator
  does outside its allow-example-urls mode. A resource's own canonical `url`
  and `Bundle.entry.fullUrl` are exempt.
- Report an extension whose definition cannot be resolved as an error ("could
  not be found so is not allowed here") regardless of its domain, matching the
  reference validator; previously private and registry domains were
  information and warning. DICOM (nema.org) and the tooling namespace stay
  allowed.
- Report a `Coding.system` in the core namespace (`http://hl7.org/fhir/<name>`)
  that no loaded package defines — typically a DSTU2/STU3 URL such as
  `http://hl7.org/fhir/v3/ParticipationMode` — as an error, alongside the
  unresolvable-code-system warning.
- Validate a resource against every profile in `meta.profile`, not only the
  first; `meta.profile` often lists the base resource before the IG profile.
  Findings shared by several profiles are reported once.
- Apply a binding declared on a choice type slice
  (`item.location[x]:locationCodeableConcept`) to the matching value.
- Address primitive extensions as `Patient.birthDate.extension[0]` instead of
  `Patient._birthDate.extension[0]`.
- Hold the targets a resource carries itself — Bundle entries and contained
  resources — to the targetProfiles of the Reference that points at them by
  default, as the reference validator does. A target that conforms to none
  of the choices made for its type draws one error per reference ("Unable to
  find a profile match for … among choices: …"); the core definition counts
  as a choice when listed, and the target's own targets are followed within
  the conformance depth bound. References in extension values are held to
  the targetProfiles of the extension's definition, and the resources a
  Parameters groups resolve each other's references. Targets fetched from a
  server are still checked only with
  `recursiveReferenceValidation.validateTargetProfiles: true`; `false` turns
  the check off.
- Report a QuestionnaireResponse whose questionnaire cannot be resolved as the
  reference validator does: at the response, with its wording, and only as
  information for an `example.org` questionnaire.
- Warn when a slicing cannot be verified because a reference target that a
  profile, value or pattern discriminator reads cannot be resolved, including
  closed slicing with an element no slice could claim. The reference
  validator reports such an element as matching no slice; Records still
  leaves the slice undecided and keeps the notice informational for type
  discriminators.

### Fixed

- Capture only a profile referrer's canonical identity and issued package provenance during dependency lookup, avoiding repeated cloning and hashing of unrelated StructureDefinition content. Preserve immutable request scopes, selected target bytes, package directories and incomplete-dependency limits.
- Reconcile a document Bundle's redundant Composition slice minimum in single-resource validation using the same causal document-context findings as batch validation. Retain independent slice minima, child defects, unverified dependencies and nested Bundle boundaries.
- Preserve incomplete profile authority when an extension package cannot be downloaded or its installed manifest cannot be verified. Failed remote resolution no longer reports a valid extension as forbidden; available definitions and definitive misses retain their existing behavior.
- Refuse public synchronization when requested release versions differ from the source package manifests, and refuse ambiguous npm registry lookups. Execute portable exported tests in public CI and verify content-bound current release acceptance separately from historical parity evidence.
- Select required bindings from coherent own resource snapshots whose slicing bases omit optional element IDs. Root and nested slice membership is evaluated for each instance; ambiguous ownership or missing terminology authority remains explicitly unverified, and source profiles stay unchanged.

- Validate unversioned UN-M49 codes, region/country filters and English displays through a source-pinned provider snapshot. Preserve selected CodeSystems, exact-edition requirements, failed package lookups and unknown codes/languages; capture selection failures with their cache entries so another loader cannot reinterpret a failed lookup as absence.

- Resolve profile, extension and datatype binding versions from the ValueSet validator's own package stores. Independent instances and explicit empty stores no longer inherit a binding version from an unrelated global package catalog.

- Keep installed profile package origins on the loaded definition, including shallow validation snapshots. Equal canonical URLs and business versions in independent loaders no longer overwrite dependency selection; host/DB profiles cannot inherit unrelated installed provenance, and clearing one loader retains origins held by other requests.

- Retain unsupported, failed and non-Boolean FHIRPath constraint evaluations as case-bound unchecked evidence. Missing local ValueSets no longer make `memberOf(...).exists()` pass; single and batch validation preserve incomplete checks even when Advisor Rules suppress the visible diagnostic. Keep dynamic constraint findings in the profile aspect so deduplication and aspect projection cannot turn a failed profile constraint into a valid result.
- Reject malformed successful responses in the MII parity harness instead of counting them as empty validation results. Preserve rule/profile/completeness evidence and exclude explicitly incomplete runs.
- Share occurrence-aware semantic matching between the MII and public HAPI parity lanes. Distinct causes, array items and defining profile versions remain visible as differences; explicitly equivalent URL/extension and UCUM findings can match.
- Remove semantic suppressions from MII parity and preserve reported severity. Keep failed or unavailable checks visible while excluding incomplete runs; report verdict, error, warning and severe-finding parity with separate completeness counts. Cardinality matching requires the same numeric limit and observed count and does not infer a limit from a generic required-slice message.
- Generate extension snapshots from differential definitions before validating their values, preserving inherited restrictions and the requested FHIR release. UKCore ConditionEpisode values can no longer bypass their declared type solely because the package omits a snapshot.
- Propagate the patched transitive UCUM CSV parser to exported repositories and the GitHub Action. Document the required consumer-root npm override and audit the packed consumer dependency graph.
- Check the binding a profile puts on a Coding slice even when the slice
  fixes a value inside a nested slice of its own: KBV's MIO Impfpass slices
  `Observation.code.coding` by system and fixes a display extension in each
  slice, and no coding was placed in its slice, so its required value set,
  and the version the value set pins, were never checked. Slices told apart
  by a fixed discriminator value are no longer mistaken for slices sorted by
  their value sets, which had dropped every finding of such a binding.
- Resolve canonicals that a profile references — its base definition, slice
  type profiles, extension definitions and reference target profiles — at the
  releases its own package depends on, as the HL7 reference validator does:
  the profile's package first, then its dependency closure breadth-first. A
  nested extension's profile resolves in the package context of the extension
  definition that declares it. A declared release that is not installed is
  stood in for by the closest installed release of the same major and minor
  version; without one the reference resolves as before. An unversioned
  reference used to take the newest installed release, so a profile built on
  ISiK Basismodul 2.0.x was checked against Basisprofil DE 1.5.4's
  `identifier-kvid-10` (type KVZ10) instead of 1.4.0's (type GKV).
- Accept a versioned coding that a value set lists among its concepts even
  when the pinned release of the code system is not available, as long as the
  value set's include pins that release itself; a list without a release does
  not vouch for the version a coding claims. A code missing from the lists
  stays unverified, since the value set version at hand may not be the one
  the profile was built on; a Coding.version that differs from the include's
  is reported as before.
- Resolve an unversioned profile of an earlier IG line that only an older
  installed release carries, such as ISiK Basismodul 2's
  `https://gematik.de/fhir/isik/v2/Basismodul/…` profiles. They were kept out
  of the package index because what they reference resolved at the newest
  releases instead of the ones their package depends on; it now resolves at
  those.
- Isolate dependency-selected terminology package copies and derived caches for concurrent bindings, including equal canonical URLs and business versions.
- Keep profile-discriminator verdicts local to one slicing invocation and preserve unknown conformance when validation is incomplete or an alternative target profile cannot be checked.
- Honor each ConceptMap group's source and target CodeSystem versions.
- Compare public parity findings by explicit semantic equivalences instead of treating related element paths or broad HL7 issue buckets as proof of agreement.
- Integrate dependency-aware profile references with recursive conformance and extension target-profile checks, including embedded type profiles during snapshot generation.
- Keep unavailable preferred/example terminology advisory during conformance checks; required and extensible bindings retain incomplete evidence.
- Correct two UKCore clean-corpus display values and restore them to the precision denominator without relaxing gates.
- Validate slices nested inside extension values using the extension's own profile and dependency context. Report snapshot child discriminators that lack a fixed value, pattern, or required binding, while preserving an unknown result when inherited metadata is missing. Keep issue targets on the containing resource's concrete extension path.

- Respect `local-only` terminology resolution for code validation, including missing ValueSet and fallback-server checks. Unavailable local binding authority remains explicitly incomplete; enabled remote strategies and disabled code delegation retain their behavior.

- Validate Reference slices selected by resolved `code.coding` using required own snapshot assertions, retaining declaration owners, occurrence isolation and incomplete alternatives. Preserve proved local named-code rejection in simple exact-edition ValueSet bindings; unknown filters, imports and edition alternatives remain unverified. Conformance reports disclose reference CLI message limits without truncating Records output or changing comparison scores. Keep embedded extension declarations and lookups in their own resource profile context. Normalize concrete and ofType choice paths consistently in conformance comparisons.

- Preserve Unknown when a CodeSystem kind lookup fails; a metadata-only CodeSystem still establishes its resource kind without asserting code membership. Explicit conformance terminology imports preserve fixture providers and reject ambiguous unversioned edition selection.

- Bind package profile and index reads to one checked physical file handle, preserve file-size limits during growth, and report observed source changes as incomplete instead of trusting replacement definition bytes.

- Keep known local display decisions independent of incomplete ValueSet filters when the actual CodeSystem selection is unambiguous. Preserve edition and language uncertainty, and do not use opaque designation rows as label authority. Extension value bindings retain their initiating FHIR release and profile context.

- Preserve the defining package of inherited type profiles during snapshot expansion, detached dependency copies, and intermediate snapshots. Explicit overrides resolve from their own package; unavailable inherited dependencies remain incomplete instead of borrowing a derived definition.
- Allow confirmed R4/R5 Resource and DomainResource subtypes to be evaluated against their loaded profile rules. Apply inherited element addresses to the concrete instance without changing source definitions; unavailable inheritance evidence remains incomplete.

- Require concrete instance admission before abstract-profile equality or inheritance; abstract instance markers never enter recursive evaluation. Unsupported family/type evidence stays incomplete without borrowing R5 ancestry for R6.
- Compare bounded DocumentReference Attachment size findings by their exact stated/decoded byte counts and concrete field, preserve applied-profile provenance separately from unattested rule definers, and retain unmatched duplicate or conflicting occurrences in public and MII comparisons.
- Do not impose a Bundle entry slice profile on every resource of the same type when membership uses a profile discriminator. Slice minimum and closed rules remain enforced by slicing, and explicit child profile claims and type-only slice requirements remain validated.
- Dependency capture now preserves an already-issued profile package origin through both detached-copy steps and nested lookups. Package-scoped profile references and ValueSet bindings therefore keep their selected source edition. Changed identities, serialized/host profiles and forged origins cannot acquire authority; FHIR serialization and hashes of individual copied lookups remain unchanged. Resolution-context isolation and transitive dependency completeness remain separate work.
- Prepare a type discriminator for disjoint declared choice variants in generated snapshots. Preserve all allowed parent types and use open slicing when a permitted type has no declared variant; keep explicit slicing and ambiguous groups unchanged.
- The clean-corpus example-URL allowance now reaches recursive target-profile evaluation before a reference verdict is produced. Required-field and independent reference errors remain visible; terminology that cannot be checked remains incomplete.
- Retain explicit unverified CodeSystem evidence when no eligible terminology server can be asked or a remote circuit is open. Compatibility acceptance stays separate from complete membership evidence; informational diagnostics carry incompleteness through Single and Batch validation, while authoritative local/remote membership and known invalid codes remain unchanged.
- Evaluate local concept `=`, `is-a`, `descendent-of` and `is-not-a` bindings using tri-state, edition-scoped CodeSystem authority. Complete interpreted hierarchies can prove complements; fragments retain observed paths without inferring absent relationships. Preserve unknown exclusions, alternative editions, remote ordering and explicit two-phase enforcement, and retain direct membership rejections instead of losing them at a boolean boundary. Generic expansion remains unchanged.
- Resolve piped compose editions for display authority and prevent registered terminology statistics from looping while LRU reads reorder live keys.
- Load the selected local CodeSystems before Single ConceptMap business rules, matching the existing Multi path. Reject a local terminology declaration when the actual selected resource has the wrong kind or canonical, preserving unavailable authority as undecided rather than treating a contradictory body as a ValueSet or CodeSystem.
- Honor the configured terminology resolver for profile `memberOf` constraints in single-resource and multi-aspect validation. Local prechecks no longer cache misses or finalize membership from unrelated package stores before the scoped resolver runs.
- Terminology reference and nested Coding checks reuse the configured ValueSet validator package loader and request cache instead of reconstructing a loader with global package directories.
- Conformance runs verify that fixture Git metadata belongs to the fixture checkout, prohibit clone/fetch/checkout under `--skip-download`, and require an explicitly SHA-pinned content lock for vendored fixture bytes. Reports retain the selected source kind, revision and content digest; report freshness hashes unversioned fixture contents instead of an ancestor repository.

Require matching Git administrative directories or registered linked-worktree back-links before fixture Git provenance, fetches, or checkouts. Foreign parent pointers and symbolic `.git` markers are rejected even when Git reports the fixture directory as its top-level.
- Expose the existing OperationOutcome decoder through the conformance tooling surface so parity checks preserve finding metadata without importing a deprecated internal compatibility path.
- Preserve the selected genuine StructureDefinition, Questionnaire, ValueSet and CodeSystem business versions when registering bare canonical aliases in the conformance runner. Package release versions never replace resource business editions.
- Declared abstract resource profiles now use the request's R4/R5 ancestry: Bundle, Binary and Parameters cannot declare DomainResource, while Patient can and all known concrete resources can declare Resource. Proven mismatches select and validate the concrete core base definition in single, batch and direct structural paths. Missing, incompatible or unreadable fallback definitions remain visibly incomplete; unsupported R6 ancestry is not inferred from R5. Proven declaration mismatches remain published alongside existing missing/unreadable-base diagnostics in single and batch results when fallback fails; unevaluated batch aspects remain explicitly invalid. An explicitly incompatible base FHIR family is rejected without inferring an absent family.
- Validate local ValueSet `=` filters against explicitly declared CodeSystem code, string, and Boolean property facts, including repeated values. Keep absent or ambiguous facts, unsupported types, custom filter collisions, and unavailable editions unverified; preserve compose exclusions and the selected terminology scope.
- Direct resource slices combining TYPE and PROFILE at the same path now preserve confirmed, disproved, and unverifiable conformance in either discriminator order. Explicit type constraints remain authoritative alongside profile receipts, and unknown profile membership remains possible with incomplete diagnostics.
- Direct resource profile slices now preserve request-scoped confirmed, disproved, and unverifiable conformance in complete applicable local groups. Unverifiable occurrences remain possible members with explicit incomplete diagnostics; definite minima, maxima, closed nonmembers, and ordering observations remain visible.

Keep datatype profile-pattern slicing on its existing matcher; resource conformance receipts apply only when the discriminated element types are resources.
- Preserve explicitly declared error severity when the profile constraint producer reports dom-6, including standard and strict modes. Generated narrative advice retains its existing best-practice policy.
- TYPE slicing now recognizes concrete DomainResource subtypes from the installed FHIR model ancestry. Abstract resource markers and datatype-shaped values do not establish DomainResource membership; selected-release/profile resolution and genuine slice cardinality checks retain their existing behavior.
- Preserve profile bindings while merging datatype constraints, and select slice bindings per actual indexed occurrence with explicit incomplete results for unproved or ambiguous membership.
- Match direct exists-based slices using required or prohibited cardinality at the exact discriminator path. Preserve unknown slice membership, incomplete validation, and proved independent cardinality constraints.
- Explicit Quantity ValueSet bindings validate unit membership independently of UCUM syntax, retaining declared required strength for both Quantity and coded choice alternatives. Missing ValueSet authority remains incomplete.
- Conformance terminology imports refresh the same successfully registered supporting Questionnaires after all imported authorities are ready, so answer checks use the final terminology revision.
- Missing nested-extension arrays still enforce the selected profile's inherited required subextensions.
- Externally registered StructureDefinitions now resolve their attested business editions within the actual FHIR family. Ambiguous edition requests and caller-supplied editions not supported by the definition remain unresolved, and clearing registered profiles removes the associated edition keys.
- Preserve proved optional FHIRPath ValueSet OR alternatives through the scoped terminology resolver without hiding unresolved membership or unexpected failures.
- Evaluate StructureDefinition constraints on metadata-only primitive elements at their original array positions, and preserve extension context while evaluating an absent primitive string value.
- Preserve explicit incomplete evidence for unresolved reference and discriminator metadata diagnostics across slicing discriminator types. Warning and information severities remain unchanged; undecidable profile conformance is no longer cached as complete true. Slice membership, cardinality rules and reference/profile fallbacks are unchanged.
- Imported terminology can retain all named concept IDs with complete details for explicitly selected codes. Membership, requested edition and own display coverage are checked separately; unavailable editions, unverified displays and unsupported expression semantics remain unverified. Conformance imports verify V2 source/output and exact detail-selection hashes within the existing resource budget.
- Local Coding membership now retains incomplete evidence when no exact local CodeSystem can verify it, and reuses actual verified CodeSystem responses within the same validation run. Missing CodeSystem warnings preserve their severity while exposing incompleteness.
- Local Coding checks now derive inactivity from ordered status and inactive properties using the FHIR validator 6.9.11 policy. Retired concepts retain separate inactive and retired warnings with property provenance, without replacing display or ValueSet membership findings.
- Local CodeSystem and binding display checks honor the owning resource language and exact Coding edition, preserve uncertain language coverage explicitly, and retain independent code/lifecycle errors; embedded resources keep their own language. Later exact remote display evidence can resolve absent local display authority; alternative editions preserve Unknown until one authoritative acceptance or complete rejection of every candidate. All-versions compose pins retain their wildcard meaning.
- LOINC named-inventory imports retain exact unnamed source rows and relationships in a bounded, hashed metadata ledger. They preserve every nonempty code, refuse incomplete selected relationships, and keep the legacy rich-import output contract.
- Avoid false missing-Library errors for inline or ambiguous R4 `text/cql` criteria and for explicit CQL identifiers with a declared cqf-library or expression reference, while retaining the explicit identifier prerequisite and unrelated Measure findings.
- Check every Coding in a CodeableConcept for synchronous FHIRPath `memberOf`, preserving supplied systems and unknown Coding values. An explicit ValueSet business version uses only its exact local cache key; missing version evidence stays incomplete or reaches the configured resolver. Keep input collections separate from CodeableConcept Codings and retain the existing SD optional resolver path. Treat malformed or inherited Coding identity as unknown local evidence and stop before inspecting later Coding properties after a proven member.
- Preserve Coding systems in local FHIRPath `memberOf` checks, including ISO country membership. Keep unknown OR alternatives and misses against expansions with an unfulfilled declared total unverified, allowing the configured scoped resolver to decide them. General and StructureDefinition constraint paths share these prechecks; verified positive alternatives retain their existing verdict and severity policy.
- Preserve all original profile declarations and malformed metadata in MII
  comparison requests, and keep unprofiled inputs unprofiled. Explicit corpus
  aliases replace only the aliased declaration, retaining additional constraints
  and reporting the transformation. Both engines receive the same input.
- Preserve positional native MII lookup argument identities, including caller definition contents and package origin, nulls, supplement-list fingerprints and Boolean flags. Distinct parent/package contexts no longer collapse into an identical delegation or static selection. Non-definition Resource contents remain hash-only; strict evidence, conversion coverage and case contexts include the additional metadata while retaining legacy report scope.
- The MII comparison runner now uses an explicit terminology endpoint throughout
  engine initialization and request settings, isolates engines by strategy and
  endpoint, and retries failed initialization. Runs without an endpoint default
  to local-only validation; mode names no longer imply a shared terminology
  service. Reports retain the effective Records terminology endpoint.
- Conformance checks now preserve an unknown, incomplete result when the requested target profile definition is unavailable. Missing definitions emit semantic information without inventing target noncompliance or caching a complete verdict; known outcomes and operational failures retain their behavior.
- Built-in empty Narrative findings now carry their Narrative rule definition independently from the applied resource profile. Quality comparisons require the same concrete Narrative field for txt-2, retain occurrence multiplicity, and keep malformed or incomplete identity unassigned. Custom constraints using the same key in another defining namespace retain their existing identity contract; builtin Narrative findings cannot attest a foreign definer.
- Resolve textLink data references against structured FHIR element IDs, keep XHTML htmlid checks separate, and retain incomplete status when an external target context is unavailable. Preserve Bundle target context across structural validation and avoid duplicate URI errors for the same missing textLink data fragment.
- OperationOutcome conversion preserves bounded issue identity and explicit validation completeness through typed FHIR extensions. Empty or unusable findings emit a neutral information issue with unknown completeness instead of an invalid empty issue array.
- Keep parity comparisons within the resource occurrence established by navigational FHIRPath evidence. Ignore quoted, comment and argument text as context; retain grouping and explicitly indexed child membership, keep projected or unresolved child selections opaque, decode delimited property identifiers, and reject contradictory raw and derived scopes while preserving one-to-one issue consumption. Explicit collection indices also retain their identity across plain and escaped delimited property names.
- Recognize explicit cross-engine missing-timezone and missing-contained-reference findings in parity comparison, while preserving occurrence counts, severity, profile, index and resource-context guards. Native diagnostics carrying an explicit defining profile remain unadjudicated until their defining-rule authority is established. Other primitive-format and external-reference failures remain distinct.
- Restrict missing narrative XHTML suppression to advisory Patient narrative rows recorded by the real generator at the same profile and occurrence. Preserve independent dom-6 profile constraints, hard errors, and findings without ownership receipts.
- Preserve the canonical Patient narrative constraint when the same missing-narrative occurrence also produces generated best-practice advice after issue policy. Keep custom dom-6 expressions, sources, profiles, nested occurrences, escalated errors, and unknown or mismatched requested/selected FHIR releases distinct.
- Compare bounded code-whitespace and uppercase UUID findings by exact primitive values, original fields and native issue kinds, preserve resource-profile context without inferring selected rule definers, and retain conflicting, incomplete or duplicate occurrences in public and MII comparisons.
- Unverified profile conformance is reported as incomplete information rather than a validator execution error. Actual execution failures remain errors, definite profile violations remain invalid, and incomplete verdicts are retried instead of cached.
- Profile conformance now isolates cached verdicts by the enclosing Bundle and containing resource, so a shared resource object cannot reuse a verdict reached against another reference context in the same batch.
- Profile conformance checks now report semantic incompleteness when an actually requested target reaches the recursion limit. They retain the existing limit and return an unknown verdict without loading or recursively validating the target.
- Retain a safe operational diagnostic when recursive profile loading fails, while keeping unavailable definitions and failed checks unknown and uncached.
- Retain safe operational evidence when recursive profile pinning or preparation fails, keeping unverified targets unknown and retryable.
- Profile loading checks the requested canonical, business edition and FHIR release against the actual StructureDefinition across package/example selection, host sources, caches and snapshot loading. Missing exact editions and undocumented spelling aliases remain explicitly unresolved; R5/R6 partial versions retain their documented selection behavior. Snapshot reuse selects the current definition first, including pin changes and tenant misses.
- Resolve package-owned profile references from actual selected dependency definitions, preserve literal package releases and opaque unavailable dependencies, and retain scoped incompleteness receipts through single/multi validation, snapshots, extension and target checks. Isolate derived caches by actual definition and request owner; never substitute foreign same-version definitions for unavailable package content.
- Preserve OR membership evidence for datatype profile alternatives and independent slice constraints. Include requested FHIR family in generated snapshot caches, and materialize inherited nested extension definitions before checking their cardinality.
- Reuse bounded package-reference inventories within each resource validation, verify selected file bytes and captured directory boundaries, and re-evaluate dependency-backed differential snapshots on fresh requests. Preserve explicit snapshot limits as visible incompleteness and keep ordinary host resolution outside implicit inventory budgets.
- Preserve the package definer of inherited Reference and Extension valueReference target profiles independently of datatype profile overrides. Reject a canonical actually owned by a dependency manifest for another FHIR release instead of resolving it globally. Generated snapshots re-read actual parent/type-profile bases, including permitted host fallback after an exhausted package graph, and key reuse to verified metadata. Explicitly registered profiles retain their existing authority.
- Preserve a proved profile conformance failure when a separate validation dependency is incomplete, while retaining incompleteness diagnostics and leaving operational failures undecidable.
- Forward request-scoped publication policy to canonical metadata validation: HL7 canonical resources need their own workgroup in publication mode, with the reference SID exception; normal validation stays permissive for missing workgroups. Reject prototype-named workgroup codes without throwing. The conformance runner now applies the real publication context while preserving its release-specific terminology endpoint and remote budget across publication boundaries.
- Quality Public/MII OperationOutcome comparison reuses the bounded Records metadata decoder, retains FHIR severity and explicit incomplete findings, and checks simultaneous native defining-profile and constraint evidence across both diagnostics and details.text. Conflicting native identity cannot attest an annotation or consume a finding in 1:1 matching; identical witnesses and legitimate raw Records findings retain their existing behavior.
- Avoid interpreting malformed primitive values as unit codes for a Quantity-only binding. The structural type error remains, while genuine Quantity unit membership and UCUM syntax checks retain their existing behavior.
- Questionnaire registration now preserves its selected FHIR family when prewarming answer ValueSets. Cached Coding display checks use scoped definition identities and the requested Coding version.
- Registered Questionnaires retain their own editions separately. Versioned responses reject a different registered edition and can still resolve an available matching host or package definition; unavailable requested editions remain unresolved.
- Preserve the builtin ref-1 rule definer separately from the applied validation profile, including bounded OperationOutcome metadata. Reference-rule parity comparison now requires the same concrete Reference field and missing local fragment, preserving duplicate occurrences and leaving unknown or malformed provenance unadjudicated.
- Preserve authoritative remote display rejections from Parameters and typed OperationOutcome through display reconciliation. Unknown or failed fallback checks cannot replace established display, membership or inactive findings; status-only fallback preserves independent display and lifecycle issues. Shared conservative display-choice parsing remains available for legacy unmarked compatibility results.
- Report unavailable resolved-code discriminator metadata when an available composite discriminator otherwise hides uncertainty. Count proved parent/reslice membership consistently, retain known ancestor cardinality and ordering beside child ambiguity, and keep uncertain child assignment separate.
- Resolve value/pattern code slicing from actual referenced target code and the target profile’s fixed/pattern metadata. Missing discriminator metadata remains unverified; known required Reference child violations and unavailable-target findings are preserved independently. Preserve proved nonmembers and ordering alongside unknown references; only proved nonmembers form openAtEnd gaps, and partial composite evidence cannot establish slice order. Report simultaneously proved sibling code matches as ambiguity, keep their possible counts separate from assigned counts, and retain blocked-metadata behavior outside exact resolve().code.
- Preserve possible exact resolved-code slice membership when bounding required minima, including unresolved metadata; keep independently proved cardinality violations and mark unavailable code metadata as incomplete through semantic and conformance checks.
- Keep one invocation-local resolution of each exact Reference for supported post-resolve PROFILE slicing, so prepared conformance receipts and slice assignment use the same target object. Preserve unknown resolutions, exact source/edition/FHIR guards and physical occurrence cardinality.
- Preserve incomplete exact resolved-code slicing when a Reference target is unavailable, and retain independently proved slice minima from finite occurrence bounds without losing known maximum or closed-slicing errors.
- TYPE-discriminated Resource slices recognise concrete FHIR resource inheritance and reject id/extension-only datatype values. Stronger choice-type evidence and resource-definition availability checks remain intact.
- Compare bounded Appointment object-versus-array and Measure XHTML entity diagnostics by their exact parser cause and concrete field in public and MII parity checks, preserve applied-profile context and opaque conflicting evidence, and leave selected-definition validity and terminology authority unclaimed.
- Apply recursive profile and reference-target conformance checks to single-resource validation with the same raw and governed evidence policy as batch validation, retaining incomplete diagnostics and request context.
- Match supported singleton post-resolve TYPE slices using the request-bound selected target StructureDefinition type and exact canonical/edition/FHIR-family evidence. Preserve physical occurrence cardinality and known errors; unavailable type evidence remains incomplete without asserting target profile conformance.
- Profile-discriminated slices require each profile alternative to satisfy its own cardinalities, fixed/pattern values and error invariants, including single candidates and all-rejected alternatives. Unevaluated invariants retain incomplete membership.
- Slicing invariant checks use the request FHIR model and actual supplied resource context. Missing containing-resource context remains unknown, and prepared rejection cannot be overridden by a contradictory meta.profile declaration.
- Incomplete local resource-profile conformance cannot count uncertain slice membership as a proven maximum-cardinality violation; explicit conformance receipts retain priority.
- Retain explicitly confirmed profile nonmembers beside unverified occurrences for closed slicing, ordering, openAtEnd and open advice. The negative receipt requires the existing complete applicable group proof and one supported post-resolve profile discriminator; missing or unverified alternatives stay unknown, and declaration-based positive fallbacks remain outside the new proof.

An explicitly requested profile business edition now needs a matching selected StructureDefinition.version before its new nonmember receipt can produce closed-slicing or ordering diagnostics. Missing or conflicting edition metadata remains unverified; unversioned chosen definitions, existing Boolean fallbacks and FHIR publication/source selection remain unchanged.

The prepared evidence now carries the actual resolver request FHIR family, separate from the profile business edition. Contradictory or malformed publication metadata remains unknown; optional publication absence is neutral only under that request-bound selection contract. Direct preparation without that context remains opaque, while legacy Boolean verdicts are unchanged.
- Retain an impossible slice minimum when the complete present occurrence count is smaller than the selected snapshot slice minimum, even if reference or discriminator metadata is unresolved. The additional bound requires a consistent unconditional snapshot definition, a valid integer minimum and the complete local group from the input resource; unproved metadata or group projections keep their existing incomplete outcome.
- Distinguish successfully evaluated but incomplete slicing from execution or invalid-definition failures with `profile-slice-validation-incomplete`. Unresolved reference, target profile/type and discriminator metadata preserve severity, explicit incompleteness, clinical findings and verdicts; actual exceptions and undiscriminated invalid profile definitions retain their existing error code. Consumers should expect deterministic issue IDs to change for renamed incomplete findings.
- Finite slicing minimum proofs now use snapshot metadata exclusively. Empty or malformed snapshots can still fall back to differential metadata for ordinary slicing, but no longer attest a complete snapshot group or introduce an upper-bound minimum error.
- Recognize the complete SNOMED CT Compositional Grammar in coding hygiene. Malformed syntax is reported separately from terminology membership; parser resource limits remain explicitly unverified. Syntax acceptance does not establish concept membership, semantic validity, or display authority.
- Use the actual declaration-scoped StructureDefinition type when checking custom Reference target profiles. Preserve explicit core resource type semantics and leave unavailable custom profile kinds undecided instead of borrowing a shared cached edition.
- Preserve incomplete terminology evidence for unresolved CodeSystems, missing concepts in fragments, exhausted remote validation budgets and unverified national editions without hiding independently proved code or display errors.
- UCUM parser failures now retain explicit incomplete evidence through single/multi-aspect validation and OperationOutcome output instead of silently accepting the unit or asserting it invalid. Unchecked parser results are not cached as validation verdicts. Missing concepts in example or unspecified CodeSystem content remain incomplete; complete definitions still reject unknown codes.
- Preserve informational, incomplete CodeSystem membership evidence when remote code validation is explicitly disabled and local membership is unavailable. The compatibility acceptance result and local syntax/known membership checks retain their existing behavior.
- Preserve explicit CodeSystem display-mismatch evidence from local or configured terminology validation instead of suppressing it with unversioned static display aliases. Displays confirmed by the resolved source and existing offline compatibility checks retain their behavior.
- Parse terminology display choices without joining comma-separated designations. Preserve apostrophes, internal punctuation and source language suffixes.
- Keep typed display errors when their human-readable choice list is truncated or malformed; typed preferred displays retain priority.
- Do not use overlapping LOINC vocabulary to suppress a display rejection from the selected terminology source; case and formatting equivalence remain supported.
- Remote CodeSystem validation carries resource.language as displayLanguage through primary and fallback requests, and keeps completed and in-flight results separate for different display languages. Calls that omit the language preserve their existing request and cache behavior.
- Reuse verified CodeSystem results in the same resource terminology pass only for the exact code, system, display, FHIR version, CodeSystem version and own language. Actual local definitions retain priority; embedded resources and new invocations cannot borrow parent evidence. Preserve typed code/display negatives and lifecycle findings while avoiding redundant local Unknown receipts.
- Keep terminology definitions, expansions and binding decisions within the effective organization, server, FHIR family and host-source revision. Preserve the initiating source across asynchronous lookups, and share the same scoped expansion with synchronous memberOf. Explicitly registered definitions stay runtime-local and FHIR-specific. Separate requested business versions from FHIR publication cache selectors and preserve submitting contexts through remote request queues.
- Keep captured profile lookups separate across loader owners, policy changes, host-source installations and externally registered definitions. Bind initiating tenant/settings/pins and host capabilities before asynchronous resolution; prevent expired lookups from reading or publishing shared policy caches. Dependency evidence retains every lookup and excludes private reuse identities; a resolution-owner change during materialization makes evidence unattested. These safeguards do not attest immutable package inventories or transitive snapshot closure.

Keep terminology canonical-index generations separate while rebuilding or clearing them, so concurrent callers cannot use a prior store's index under a new signature. This fixes the controlled race; the earlier intermittent MII PATH Unknown remains causally unexplained.
- Keep the effective FHIR publication context separate from ValueSet and CodeSystem business versions. Record the selected definition and package-manifest hashes when reading a ValueSet; changed or missing source metadata cannot attest a different publication for an already cached object. Preserve that object origin across package-index invalidation.
- Keep versioned Core Narrative txt-2 comparisons tied to the same concrete Narrative field and exact corresponding defining-rule edition. Builtin codes retain their unversioned authority; foreign custom constraint comparisons remain unchanged.

- Slice cardinality findings now retain the exact versioned profile that defined
  the slice, so a finding can open the applicable profile definition even when
  another validation context is active.
- Accept a reference to any absolute URI the reference validator accepts
  (a lower-case scheme, such as SMART Health Cards' `resource:0`, resolved
  through the Bundle entry's fullUrl) instead of reporting an invalid format.
- Browse profile comparisons and targeted Records checks now validate every
  applied profile when multiple profiles are selected. Previously, only the
  first profile was checked, so findings from additional profiles could be
  missing. Per-profile findings, governance evidence, incomplete outcomes, and
  cancellation are preserved.
- Fail a reference that two Bundle entries answer, as the reference
  validator does: a `urn:uuid` shared by two fullUrls resolved silently, and
  an ambiguous absolute reference outside a document or message went
  unreported.
- Warn about an Attachment without data, url, contentType or language
  wherever the element is typed Attachment, such as
  `RelatedArtifact.document` or `Library.content`, and also when it carries
  only extensions. An empty attachment, or one whose data-absent-reason
  explains the missing content, stays without the warning.
- Judge a base64Binary value without its whitespace: whitespace is a warning
  in R4, whose base64Binary pattern allows it, and an error from R5, instead
  of an invalid-format error in every release. Attachment data and hash
  wrapped into lines still fail, as the reference validator decodes them
  strictly (RFC 4648).
- Report a coding whose system a value set's compose never names as not in
  the value set, even when the expansion cannot be built without a
  terminology server — `http://www.cms.gov/…` is not the
  `https://www.cms.gov/…` system a CARIN BB value set includes. Previously
  such a required binding was only reported as unverifiable.
- Keep the binding warning of every repeat whose code is valid: an invalid
  code in one repeat (`performer[1].function`) silenced the non-required
  binding warnings of all repeats of the element.
- Do not count a code from another code system as a member of an
  extensible or preferred value set because a code of the same text occurs
  there, such as US Core's `transmitter` in the THO provenance participant
  types.
- Treat a CodeableConcept whose codings carry nothing but a display as
  having no code under its binding: an extensible binding asks for one, and
  each coding without a system is reported as such.
- Read a primitive's extensions from its `_element` sidecar when a datatype
  profile decides a profile-discriminated slice, and evaluate the profile's
  invariants with the datatype's type information. A CH EPR birth name with
  the `BR` qualifier now falls into `name:BirthName` instead of violating
  `ch-epr-fhir-1` in `name:HumanName`.
- Place a resource that declares none of the slices' profiles in the slice
  whose profile it conforms to where two slices admit its type (IHE MHD's
  SubmissionSet and Folder entries are both Lists).
- Count the extensions of a primitive in its `_element` sidecar when a slice
  requires them (`name:BirthName.family.extension`).
- Scope slicing nested inside a slice that is told apart only by a required
  binding to the instances in its value set. CH Lab's blood count no longer
  checks every component against the RDW slice's `fL` unit. As in the
  reference validator, the binding is read from the first element along the
  discriminator path that is not itself sliced, and it decides a single
  value only: FR Core qualifications that carry two codings belong to no
  qualification slice and are not held to their closed coding slicing.
- Tell apart a slice discriminated on `$this` that fixes nothing itself by
  its required binding alone, as the reference validator does. What its
  children fix, such as the url of an optional sub-extension, no longer
  keeps an element without that child out of the slice: gematik Directory
  characteristics without an additional note matched no slice of a closed
  slicing.
- Accept the extensions the reference validator defines itself, such as the
  IG publisher's `instance-description` in `meta.extension`, instead of
  reporting them as extensions that could not be found.
- Resolve references against a Bundle's own entries when evaluating that
  Bundle's invariants, whether it is validated alone or within a batch: Da
  Vinci PCT's AEOB packet (`pct-aeob-packet-1`, every reference resolves to
  an entry) no longer fails on a packet that holds all its targets.
- Report a relative reference on a document, message, transaction or batch
  Bundle's own elements (such as `Bundle.identifier.assigner`): outside any
  entry it has no fullUrl to resolve against, which the HL7 reference
  validator reports like a reference in an entry without fullUrl.
  `Bundle.signature` stays exempt.
- Leave a slicing undecided when a `resolve()` discriminator reads a
  canonical Records cannot resolve, as it already does for an unreadable
  Reference, instead of reporting the slice's minimum as unmet (MedMorph's
  `Library.relatedArtifact`).
- Accept an extension whose element context names a choice element without
  `[x]` (`Patient.deceased`), as the reference validator does.
- Read the extensions of a primitive choice value (`doseNumberString` with
  its `_doseNumberString` sidecar) where a type slice's children are checked:
  KBV Impfpass' required data-absent-reason on an unknown dose number is now
  found where the example carries it.
- Match a type-sliced choice element by the type its property names
  (`allowedMoney` holds a Money), also below repeating parents: Da Vinci
  PCT's `benefitBalance.financial.allowed[x]` no longer fails its closed
  Money slice.
- Keep the type of a choice value when a profile constraint tests it on a
  datatype element (SDC 3.0.0 sdc-uc-1 on `Questionnaire.useContext`:
  `value is CodeableConcept`), instead of reporting the constraint failed
  for a `valueCodeableConcept`, also inside Bundle entries.
- Read an element named like a typed choice as the element it is: tst-5 on
  a TestScript assert no longer counts `responseCode` a second time as
  `response`.
- Follow the reference validator in document and message Bundles: a
  relative reference resolves only through the RESTful fullUrl of its own
  entry, so one from an entry with another fullUrl misses a matching entry
  and fails. A reference outside the Composition or MessageHeader to a
  resource the Bundle does not hold is now information instead of an error.
- Count a Composition section's Narrative as present text for `cmp-1` even
  when its `div` is missing, as FHIRPath's `text.exists()` does; the missing
  div stays reported on its own. Sections with `text: { status }` no longer
  get a second, misleading `cmp-1` error.
- Validate codes against a CodeSystem's content when HL7 Terminology only
  names it: a `not-present` stub yields to a newer complete copy elsewhere in
  the package stores, so a wrong CDC Race & Ethnicity display (US Core 3.1.1
  ships the code system complete) is reported. A stub from the canonical's
  own authority, such as HL7 Terminology's licensed v2 tables, still stands.
- Apply the FHIR `code` whitespace rules to every code primitive, as the HL7
  reference validator does: a leading non-breaking space in
  `CodeSystem.concept.code` or `Patient.gender` is now an error. Codings keep
  their existing terminology rule, so nothing is reported twice.
- Type a QuestionnaireResponse answer by its value property whatever it
  carries. A `valueCoding` naming only a display (sIRB's populated
  responses) was dropped and reported as an answer of unknown type.
- Check the system of every Coding for a local label instead of a URI, as
  the HL7 reference validator does, including Codings below nested
  Questionnaire items and in datatypes the definition-driven pass does not
  reach. Tags and security labels get the same system checks — absolute,
  and defined when in the core namespace (`http://hl7.org/fhir/v3/ActReason`
  is a retired URL) — while their codes stay unchecked.
- Treat a Coding.system as absolute when it starts with `http:`, `https:` or
  `urn:`, as the reference validator does; `http:example.org/codes` no longer
  counts as a local label.
- Report an entry without `fullUrl` in a collection Bundle as an error, as
  in documents and messages: FHIR R4 and R5 require the element outside a
  POST, unidentified operation results and (R5) search or history results,
  which keep the warning. Entries of a transaction or batch response no
  longer draw it, as in the reference validator.
- Resolve a `#id` canonical inside a Bundle entry against that entry's own
  contained resources, instead of reporting it unresolved against the Bundle.
- Leave dom-6's narrative advice out for contained resources, as the
  reference validator does (`(%rootResource != $this) or text.div.exists()`):
  a contained resource is not expected to carry narrative of its own. Bundle
  entries and the resources of a Parameters are still advised.
- Follow content references before treating a property as a choice value in
  an invariant's context. `TestScript.test.action.assert` is defined as
  `TestScript.setup.action.assert`; without following it, `response` read
  `responseCode`, and `tst-6` failed on every assertion of a response code
  (CH ELM test scripts).
- Hold a coding's CodeSystem version to the release of a specification
  value set that includes one of the specification's own code systems
  without a version, as the reference validator pins it: a
  `study-design` coding at `5.0.0-cibuild` is outside the R5 value set at
  `5.0.0`. A version that only refines the included one (`5.0` → `5.0.0`)
  still matches.
- Accept a core-namespace code system that a package for the validated
  release carries, whatever release version the code system names: the R4
  extensions pack ships R5's `http://hl7.org/fhir/version-algorithm` for the
  `artifact-versionAlgorithm` extension, which was reported as undefined.
- Resolve a CodeSystem in the core namespace (`http://hl7.org/fhir/<name>`)
  only from the release being validated. R5 validation no longer accepts
  R4's `http://hl7.org/fhir/resource-types` (R5 names it `fhir-types`) and
  reports it as undefined, as the reference validator does.
- Report an undefined core-namespace system on every Coding, including
  codings inside extension values, not only on bound elements.
- Resolve a cross-version extension
  (`http://hl7.org/fhir/5.0/StructureDefinition/extension-…`) from the xver
  package published for the release being validated
  (`hl7.fhir.uv.xver-r5.r4` for R4) instead of skipping it as an R5
  definition. Its declared contexts and a profile's required slices of it now
  apply, as in the reference validator: `extension-AuditEvent.category`
  belongs on `AuditEvent.type`, not on the resource.
- Check the required and extensible bindings a datatype declares on its
  coded children wherever the datatype is used, as the HL7 reference
  validator does: an `Identifier.type` whose coding is not in IdentifierType
  (for example `v2-0203#NPI`) now gets the extensible-binding warning.
  Previously only primitive codes inside datatypes were checked.
- Decide a profile discriminator on a datatype value, which carries no
  `meta.profile`, by whether the value conforms to the slice's profile: its
  cardinalities and fixed or pattern values first, then its own invariants
  where more than one slice fits. CH eMed's split dosages now fall into
  `baseEntry` or `additionalEntry` instead of into neither, and an ISiP
  organisation's Telematik-ID stays out of the IKNR identifier slice.
- Let a slice that names a resource's base definition as its profile
  (CH eMed `Composition.author:device` names `Device`) match every resource
  of that type, declared or not, as the reference validator does.
- Reject a `date` with a month outside 01–12 (`1990-13-01`, `1990-00`), the
  year 0000 in `date` and `dateTime`, and an `instant` without time and
  time zone (`2020-01-01`), as the reference validator does; such values
  passed before.
- Report a finding that several declared profiles share once, at the
  strictest severity a profile gives it: a wrong display under a required
  and an extensible binding appeared both as error and as warning.
- Check the url a Device or DeviceDefinition is reached at for example hosts
  and specification pages, as the reference validator does; only a canonical
  resource's own url defines rather than points at one.
- Report a wrong display once when the generic walk names its extension by
  position (`extension[0]`) and the profile walk by url
  (`extension[url='ombCategory']`); it appeared as both warning and error.
- Count a complex element's `id` as content for `ele-1`, as the HL7 reference
  validator does: `identifier: [{ "id": "x" }]` or `maritalStatus: { "id":
  "m1" }` no longer fail. A primitive whose only content is its id
  (`_gender: { "id": "g1" }`) and an empty object still do.
- Report a binding finding once. A slice-scoped binding check named the
  element (`Patient.identifier.type`) and repeated a finding that already
  stood at the repeat's own path (`Patient.identifier[0].type`); a finding
  about another value set keeps its own entry.
- Apply resource-type profile selections to embedded Bundle, contained, and
  Parameters resources. Validate every declared or added embedded profile
  while counting each resource once, and retain profile provenance and
  suppressed evidence.
- Resolve a profile that an installed package ships only in its `example`
  folder, as the reference validator does when it loads the package. CPG's
  example observations declare such profiles (`chf-egfr`); Records reported
  them as unresolvable and checked the observations against the base
  resource only.
- Resolve a CodeSystem or ValueSet that an installed package ships only in
  its `example` folder, as the reference validator does when it loads the
  package: CPG's `chf-codes` and `cpg-common-persona` were reported as
  undefined code systems. A definition in a package root still wins.
- Count the definitions a package publishes among its examples as the
  reference validator loads them: a code system only MedMorph's examples
  define is no longer "undefined", and an example-host URL such as CDex's
  `http://example.org/cdex-questionnaire-example2` resolves when an installed
  package defines it.
- Report example URLs where the reference validator does: a canonical at any
  of its example hosts (`example.org`, `example.com`, `example.net`,
  `acme.com`, `acme.org`), a uri or url only when it names `example.org` or
  `acme.com`, and only where the host is the example host itself. Values of
  `textLink`, `web-source` and `ig-page-name` extensions are exempt, and
  example OIDs stay accepted.
- Decide an extension's element context below the resource root the way the
  HL7 reference validator does: an element answers to its path from the
  root, the contentReference target it re-enters (`PlanDefinition.action`
  for a nested action), its datatype (`Attachment`), paths rooted at that
  datatype (`RelatedArtifact.document`) and their base types. A
  `cqf-strengthOfRecommendation` extension on
  `PlanDefinition.action.documentation.document` now fails its
  `PlanDefinition.action` context. Contexts Records cannot resolve stay
  undecided, as before.
- Name a profiled extension below a repeating element by its place in the
  instance (`ClaimResponse.item[0].adjudication[1].extension[url='…']`), so
  its findings no longer lose the repeat they belong to or appear twice.
- Report an extension value whose JSON type its definition does not allow,
  as the HL7 reference validator does ("… definition allows for the types
  [unsignedInt] but found type integer"). Records used to fall back to the
  first declared type and validate the value against it. Camel-case
  primitive types such as `dateTime` now match regardless of the JSON name's
  capitalisation.
- Read `value` on a primitive a constraint reaches by path from its context
  as that primitive, as the reference validator does: NO Basis' inv-1
  (`actor.type.value = 'Patient'`) no longer fails on a valid appointment
  response.
- FHIRPath `resolve()` also resolves a reference string, as the specification
  allows: Da Vinci PCT's packet invariant
  `descendants().reference.all(resolve().exists())` no longer fails on
  references the Bundle holds.
- Pick out a slice of a pattern-discriminated slicing by its fixed value when
  it has no pattern, as the reference validator does. Records let every
  element into such a slice, so Dental Data Exchange conditions reported
  their problem-list category against the dental slice's fixed value and
  exceeded its maximum.
- Check the HL7 work group, publisher and committee page of every canonical
  resource published under `http://hl7.org/fhir/`, not only profiles, with
  the reference validator's table of work groups (`cgp` is Cross-Group
  Projects, `vocab` may also be published as Vocabulary); report an unknown
  or repeated work group, a missing publisher and a `#` in the version, and
  accept `retired` for informative and external standards status.
- Stop reading absence from a value set whose stored expansion is shorter
  than its declared `total`. VSAC packages up to 0.11.0 (a US Core 6.1.0
  dependency) keep only the first 1000 codes of larger expansions; a code
  beyond those is now reported as unverified (`incomplete-expansion`) rather
  than as outside the value set, on the binding and the membership path.
- Report a `#id` canonical that names no contained resource, as the HL7
  reference validator does ("The URL value '#…' is invalid because there is
  no matching target"), also in resources that contain nothing. Elements
  checked are those canonical by name (`definitionCanonical`,
  `answerValueSet`, `library`, `valueSet`); other strings may start with `#`.
- Report an invalid uri in every element that holds it: the same value in
  `identifier[0].system` and `identifier[1].system`, or in two Bundle
  entries, was reported once.
- Bind `%resource` in a profile invariant to the resource that contains the
  checked node, as FHIRPath and the reference validator define it: a Bundle
  entry's own resource or a contained resource, not the outermost resource.
  de.basisprofil's `gender-amtlich-1` failed on every bundled Patient in the
  KBV Impfpass because `%resource.gender` read the Bundle.
- Report a document Bundle's missing Composition slice once per profile that
  requires it. A profile whose `baseDefinition` names the core Bundle with a
  version (IPS 2.0.1: `Bundle|4.0.1`) no longer adds a second copy attributed
  to the core Bundle, which has no such slice.
- Report a JSON array where the base specification allows a single value —
  `Reference.identifier`, `Patient.gender`, `meta`, a choice element such as
  `valueQuantity` — at any depth, as the HL7 reference validator does ("The
  property identifier must be an Object, not an Array"). A one-item array
  used to pass unnoticed.
- Name unknown elements found below a repeating element with its index
  (`Patient.contact[0].relationshp`).
- Accept a MIME type code the way the terminology server behind the HL7
  reference validator does: the media type before any `;` needs a type and a
  subtype, and parameters are not parsed. `text/plain;base64` and
  `text/plain; charset` no longer fail the required `mimetypes` binding;
  `text/`, `a/b/c` and `textplain` still do.
- Missing `Coding.system` remains a data warning without marking validation as
  partial. Correct provenance for new results and interpret legacy unverified
  provenance by the specific issue code; real terminology coverage gaps retain
  their incomplete status. Use validation-types 0.1.13 and validator 0.7.3 to
  refresh validation cache fingerprints.
- Report a code system URL in HL7 Terminology's space that no release
  defines even when its path segment is misspelt
  (`http://terminology.hl7.org/codesystem/consentscope`), as the reference
  validator does; only the exact `/CodeSystem/` spelling was recognised.
- Leave the entries of nested Composition sections to the base rules when the
  profile refers nested sections to the base definition: the profile's
  section slices and their entry target profiles applied to nested sections
  too, so a document bundle failed on entries the reference validator does not
  constrain.
- Hold a binding on a slice nested in another slice to the instances inside
  the enclosing slice only: eCR's inline US Core race and ethnicity
  extensions each check their own ombCategory, and a type slice on a choice
  (`value[x]:valueCoding`) takes the Coding, not the text string beside it.
- Report the cardinality of a slice inside a repeating element at the repeat
  it concerns (`ExplanationOfBenefit.item[1].adjudication`), and decide a
  profile discriminator on a primitive below the slice (eu.imaging slices
  `ImagingStudy.identifier` by profile at `system`) by the slice's datatype
  profile instead of never matching.
- Report a missing required-bound element inside a slice only where its
  parent is the slice itself. A deeper parent, such as the condition of an
  action nested in a CCRR plan definition slice, may be absent from every
  instance of the slice, and then nothing is missing.
- Scope a slicing nested below other slices by every enclosing slice, not
  only the innermost: KBV's Mutterpass fixes the German display of
  component:SystolicBP's coding, which no longer applies to the diastolic
  component.
- Slice the extensions of a primitive inside a repeating element (a
  coding's display) from the primitive's `_element` sidecar instead of
  reporting the slice's minimum as unmet.
- Stop warning about `meta.versionId` `0`. A versionId is opaque, and `0` is
  the first version on servers such as Cerner's, where the warning fired on
  every resource.
- Leave a required binding to the slicing when it is what tells an optional
  slice apart: an element that does not carry one of the bound codes belongs
  to another slice rather than violating the binding (BALP's AuditEvent
  agent slices).
- Hold an extension the resource's profile does not slice to its own
  definition below the top level, as the reference validator does: each
  sub-extension to the value type of its slice (SDC `launchContext` names
  with `valueId` instead of a Coding) and the slices to their cardinality.
- Report a value on a complex extension, whose `value[x]` is closed with
  max 0, such as a `valueCodeableConcept` on US Core ethnicity: the
  definition allows no type at all.
- Accept a relative reference with a path before `ResourceType/id`
  (`/fhir/Patient/1/_history/1`) and read type and id from its last
  segments, as the reference validator does; it drew two errors. A warning
  now notes that it only resolves where the service base ends in that path.
- Test a type discriminator with a path against the type of the child it
  names, as the reference validator does: Radiation Dose Summary slices
  `Observation.performer` by type at `reference`, which is a string. Records
  compared the reference with the slice's own type and matched no slice of a
  closed slicing.
- Pin a binding to the ValueSet version a dependency without `.index.json`
  ships, and read that dependency's copy when other packages carry the same
  `url|version` with other content (stale IHE-D format codes in old
  de.basisprofil releases).
- Read `value` in an invariant on a primitive element as the element's own
  value, as the reference validator does. fhirpath.js has no such child, so
  Da Vinci RA's `ra-3` (`value.startsWith(…)` on a valueString) failed on
  every patch path.
- Find a profile or extension in whichever installed package declares it
  when the package-name routing points elsewhere. Every canonical under
  `fhir.de` was looked up in de.basisprofil only, so the extensions of
  de.fhir.medication (`ig.fhir.de/igs/medication`, used throughout ePA
  Medication) were reported as unknown. Core and cross-version canonicals
  still come only from their own packages.
- Resolve a versioned profile reference whose exact patch is not installed
  to the latest installed release of the same major.minor, as the reference
  validator does (`epa-medication-request|1.3.0` with 1.3.2 installed),
  instead of validating against the base resource only. A version with a
  pre-release or build label still names exactly one publication.
- Place a resource that declares no profile in the one slice whose
  profile's type it has, when slices are told apart only by profile
  (`Bundle.entry:Composition.resource` typed `Resource` with
  ch-core-composition), instead of reporting a required slice as missing;
  the entry is then held to that profile.
- Recognise target profiles whose names carry underscores or dots
  (KBV_PR_MIO_Vaccination_Patient) as profiles; they were taken for bare
  resource types and never checked.
- Resolve an unversioned profile that only an older installed release of
  its package defines, such as US Core's `us-core-implantable-device`, which
  US Core 9 no longer carries. Package deduplication hid those canonicals, so
  the resource was validated against the base definition alone.
- Evaluate core invariants with the corrections the HL7 reference validator
  applies to wrongly published expressions (`ras-2`, `que-12`, `tim-9`,
  `opd-3`, `eld-19`/`eld-20`, …). A RiskAssessment prediction without a
  probability no longer fails `ras-2`.
- Compare `dateTime`, `instant` and `time` values with more than three
  fractional-second digits correctly. fhirpath.js read `.566000` as 566 000
  milliseconds, so `Task` `inv-1` failed on microsecond timestamps.
- Report a `Coding.system` as a value set only when it resolves to a
  ValueSet. The IHE format code system
  `http://ihe.net/fhir/ValueSet/IHE.FormatCode.codesystem`, which R4 core's
  own `formatcodes` ValueSet includes, is no longer an error.
- Reject OID roots shorter than the reference validator accepts
  (`urn:oid:1.1`, `urn:oid:1.2`), and check unknown codes in
  `UsageContext.code`, `Signature.type`, `DataRequirement.codeFilter.code`
  and `ElementDefinition.code` against locally known code systems.
- Report an invariant whose expression evaluates to an empty collection as
  failed, as the HL7 reference validator does. US Core `us-core-17` (NPI
  check digit) now fails for an identifier whose value is not numeric,
  instead of passing silently.
- Evaluate invariants on a concrete choice element (`effectiveDateTime`,
  `component[0].valueQuantity`) through the choice element, so the value
  keeps its FHIR type and `$this as dateTime` is no longer empty.
- Apply the reference validator's corrections to `ref-1` (a Reference
  without `reference` passes) and to `vs-1` in the core vital signs profiles
  (a vital sign measured over an `effectivePeriod` passes).
- Match a display against a code system held in full ignoring case only, as
  the reference validator does: `Next of Kin` is no longer accepted for
  `Next-of-Kin`. LOINC and SNOMED CT keep their tolerance for formatting
  variants.
- Validate a resource against each canonical in `meta.profile` once, even
  when it is listed with and without a version.
- Let `resolve()` answer type tests for an absolute http(s) reference that no
  Bundle entry or contained resource resolves from the resource type in the
  URL; the reference validator fetches such a target.
- In a document or message Bundle, require an absolute reference to resolve
  inside the Bundle only where the Composition or MessageHeader anchors it
  (subject, author, encounter, custodian, attesters, sections, focus); other
  entries may point at a server, as the reference validator accepts.
- Check a Quantity's code against its code system wherever the Quantity sits
  when the system is not UCUM and the code system is available locally, as
  the HL7 reference validator does: a `doseQuantity` coded `tab` in
  `v3-orderableDrugForm` (which defines `TAB`) now fails.
- Accept a Quantity-shaped choice value in a type slice for a Quantity
  specialization such as Duration or Age: the value's type lives in its
  property name (`offsetDuration`), which the slicing has already read past.
  MedMorph and CCRR plan definitions reported their `relatedAction.offset[x]`
  as matching no slice of a closed slicing.
- Judge a QuestionnaireResponse against its Questionnaire in the release of
  the IG whose profile the response declares (`us-core-questionnaireresponse|7.0.0`
  answers the US Core 7.0.0 Questionnaire) when it names the Questionnaire
  without a version, instead of the newest local release, whose items may
  be worded differently.
- Validate recursive content at any depth. Elements more than one level below
  a recursion point, such as the answers of a Questionnaire item nested three
  deep, were not checked structurally or against their bindings.
- Take the rules of an absolute contentReference from the definition it
  names, as the reference validator does: a nested `Composition.section` in a
  profile whose snapshot refers to the base resource follows the base rules,
  not the profile's constraints on top-level sections.
- Warn, as the HL7 reference validator does, when a document Bundle entry is
  reachable only by pointing back at what the Composition reaches (R4 allows
  that for Provenance only; R5 and messages get an informational note).
- Warn when a CodeableConcept bound to an extensible value set carries only
  text ("No code provided, and a code should be provided from the value
  set").
- Warn when a Reference has neither a reference, an identifier nor a
  display.
- Report a relative reference in a Bundle entry without fullUrl for every
  Bundle type except batch and transaction responses, as the HL7 reference
  validator does; a collection or searchset entry has nothing to resolve the
  reference against either.
- Accept a relative value in a plain `uri` element (`ClinicalImpression.protocol`
  = `QuestionnaireResponse/1`), as FHIR and the reference validator do; an
  absolute URI is still required for canonicals, the url defining a canonical
  resource and `Identifier.system`.
- Evaluate the invariants of a resource carried in a sliced element (a Bundle
  in `Parameters.parameter.resource`) with that resource as `%resource`, so
  bdl-3 and bdl-4 read the Bundle's own type instead of failing on the
  Parameters around it.
- Read the searched resource type from a searchset's self link only when
  the link ends in a resource type, as the reference validator does.
  Identity Matching's `Bundle/MATCHOperationResponse` no longer makes every
  match entry the wrong type.
- Treat a choice value that is present only through its primitive extension
  (`_valueBoolean` carrying a data-absent-reason) as present in invariants, as
  the reference validator does; `Parameters.parameter` failed inv-1 ("one and
  only one of value, resource, part") on such values.
- Report a binding violation inside a slice at the element it concerns
  (`ExplanationOfBenefit.item[0].adjudication[4].reason`) instead of the
  profile's element path (`ExplanationOfBenefit.item.adjudication.reason`),
  so violations in different repeats are no longer merged into one.
- Use a slice's binding as its discriminator only when the binding is
  required, as the HL7 reference validator does. An extensible binding no
  longer lets a slice (MII Consent `category:consentCategory`) claim an
  element that belongs to another slice (`category:loinc`), which reported
  the other slice as missing.
- Report a slice that a `$this` pattern or value discriminator cannot
  evaluate — no pattern, fixed value or required binding on the slice
  itself — as an error on each element to slice ("Slicing cannot be
  evaluated"), as the reference validator does. The MII ICU body weight
  example is affected: its `category:sct` slice fixes only `coding`.
- Generate the snapshot of a differential-only profile the way the reference
  validator does where a slice takes a profiled type and the differential
  walks into it: the type profile's elements (KBV's practitioner identifiers
  carry their LANR and DN codes in de.basisprofil's identifier profiles) hang
  below the slice, and a slice child the base already holds is refined
  instead of repeated. Slices told apart by those codes now match.
- Report a uri or url that links to a page of the FHIR specification or of an
  IG under `http://hl7.org/fhir` (`observation.html`, a trailing `/`, the bare
  root) as an error, as the HL7 reference validator does: it resolves every
  value in that namespace against the loaded definitions, and a page never
  names one ("No definition could be found for URL value"). Coding systems and
  extension URLs keep their own rules.
- Report a relative sub-extension url under an extension that defines no
  sub-extensions at all, such as a cross-version extension whose value is a
  plain Reference, as the reference validator does. The check still stays
  silent when the extension's definition cannot be loaded.
- Read a binding on a child of a backbone element or datatype, and an
  extension's value binding, in the release of the package that owns the
  definition, as the terminology aspect already does, instead of the newest
  release on disk (CARIN BB 2.0.0 tooth surface codes).
- Report findings on a choice child at the choice the instance made
  (`diagnosisCodeableConcept`) rather than the element name (`diagnosis[x]`),
  so a binding violation the terminology aspect reports as well is not listed
  twice.
- Decide whether a Coding without a system satisfies an extensible or
  preferred binding as the reference validator does. Inside a
  CodeableConcept it belongs to no value set unless the value set is a single
  include that lists the code; a lone Coding without a system is not held
  against such a binding at all. Records used to count the bare code as a
  member whenever it occurred in the expansion.
- Type a Reference's targetProfile from its StructureDefinition before the
  target is checked, loading it when needed, instead of guessing from the
  profile id: CH eMed's ch-emed-medication-medicationdispense profiles a
  Medication, and a dispense's medicationReference was reported as pointing
  at the wrong type.
- Route SNOMED CT codes of the Swiss, Danish, Dutch, UK, US and IPS editions
  to tx.fhir.org, which serves them: its default server entries declared only
  the International edition, so such codes were reported as unverifiable
  instead of being checked. `@records-fhir/validation-types` 0.1.13 carries
  the new defaults; saved server settings keep their own edition lists.
- Address findings inside a type slice of a choice element by the property
  the instance uses: a missing unit in a vital-signs temperature is reported
  at `Observation.valueQuantity.unit`, not `Observation.value[x][0].unit`.
- Extend the check to the CodeSystem space of every installed HL7 IG under
  `http://hl7.org/fhir/…`: a misspelt or moved code system URL
  (`…/davinci-pdex-plan-net/CodeSystem/HealthcareServiceCategoryCSS`) that no
  installed release of the IG defines is an error. An IG that is not
  installed is not judged.
- Reject a Coding.system under `http://terminology.hl7.org/CodeSystem/` that
  no installed HL7 Terminology release (or other package) defines, such as
  `…/participant-role` or `…/v2-0360%7C2.7`, as the reference validator does.
  Every installed release counts, and without HL7 Terminology the check
  stays silent.
- Evaluate a profile invariant that tests against a type name no FHIR model
  defines as the reference validator does, as a type the value is not,
  instead of skipping it as unevaluable. PACIO ADI's `HCA-section-entries`
  (`resolve() is relatedPerson`) now fails on healthcare agent sections as
  it does there. A custom rule naming such a type still reports that it
  could not be evaluated.
- Report a relative sub-extension url that the complex extension does not
  define, as the HL7 reference validator does ("Sub-extension url 'uri' is
  not defined by the Extension …"). This applies whether or not the
  resource's profile slices the extension.
- Report an `Identifier.system` under `http://hl7.org/fhir/sid/` that HL7
  has not registered (`sid/eui-48`, where only `sid/eui-48/bluetooth` and
  `sid/eui-48/ethernet` exist), as the reference validator does. The known
  systems come from the installed HL7 Terminology and core packages; without
  them the check stays silent.
- Keep the terminology server's explanation when it cannot check a code (for
  a SNOMED CT release it does not hold, the releases it does), instead of
  replacing it with a generic "could not verify".
- Check an extension that the resource's profile does not slice against its
  own definition — value type, bindings and invariants — as the HL7
  reference validator does. A Plan-Net `newpatients` extension that lists
  characteristics while accepting no new patients now fails
  `new-patients-characteristics` even when the resource declares no profile.
- Leave a slice that is discriminated only by a required binding unverified,
  instead of unmatched, when its value set has no local expansion (PHD's MDC
  clock types): the element may belong to it, and the HL7 reference validator
  accepts it offline too. A required slice with nothing present is still
  reported.
- Resolve `us-core-genderIdentity` again. Folding US Core profile ids to
  lower case, meant for misspelt aliases such as `us-core-Patient`, also
  folded the one published mixed-case canonical, so the extension was
  reported as unknown on valid US Core 6.1.0 patients.
- Accept the `NN` + ISO 3166 country codes of `v2-0203` (`NNFIN`, `NNCH`) as
  identifier types, the national-identifier concept the reference validator
  builds from the country code.
- Reject a `ValueSet.compose.include` or `exclude` that names a code system
  by an OID HL7 registered for a code system with another canonical
  (`urn:oid:2.16.840.1.113883.5.1008` for v3-NullFlavor), as the reference
  validator does. A code system whose canonical is its OID stays valid.
- Resolve bindings with `Coding.version` from an exact local CodeSystem and a
  verifiable ValueSet composition before delegating to terminology servers.
  Preserve unverified results for missing versions, unsupported filters,
  unresolved imports and exclusions.

## [0.7.0] — 2026-09-22

This release consolidates the unpublished 0.6.3–0.6.37 development series.
It removes the deprecated metadata/reference validation envelopes described below.
It ships with `@records-fhir/validation-types` 0.1.12.

### Added

- Resolve the targets of references whose slice membership depends on them
  (`profile` discriminators and any discriminator traversing `resolve()`)
  before slicing runs, so slices such as MII
  `MedicationRequest.reasonReference:Primaertumor` are decided from the
  referenced resource instead of being reported unverifiable. Bounded by
  `recursiveReferenceValidation.maxReferencesPerResource` and `timeoutMs`,
  and absolute references stay excluded unless `validateExternal` is set.
  Opt-in through `recursiveReferenceValidation.validateTargetProfiles`, which
  also lets that existing flag take effect outside bundles for the first time:
  structural validation otherwise never reaches the server.
- An unverified binding now says why: `details.terminologyDiagnostic` carries
  the cause (missing definition, compose rules the local stores cannot
  evaluate, pinned CodeSystem version), whether the tenant's packages were
  searched, and every terminology server that was asked with the way it
  answered; `details.recommendation` names the fix. When every asked server
  failed rather than answered, the issue is reported as
  `terminology-server-failure` at the same severity, so the inspection UI
  shows a check that did not run instead of an unknown value set.
- Reported FHIR XML serialisation defects that the conversion to an object
  erases: text on an element that allows none, attributes FHIR XML does not
  define, and attributes written with an empty value such as `url=""`. Both vanish once the document becomes an object, so an object-based
  validator cannot see them afterwards and the adapter reports them while
  parsing. `parseFhirXml` returns them on `diagnostics`, and the CLI folds them
  into its issue list. A narrative whose namespace is wrong is left alone: it is
  walked as FHIR, and reporting its markup element by element would bury the
  namespace defect that actually matters.
- Reported elements that match no defined slice under open slicing, as
  `profile-slice-open-unmatched`. Open slicing permits them, but the reference
  validator still names them, and an unclaimed element is usually an unnoticed
  authoring slip. Closed slicing already reported this as an error; open
  slicing said nothing.

### Changed

- Move the validator version to 0.6.11 to cover the `resolve()`-slicing
  evaluation and its pattern-mismatch dedupe rule. Those shipped without a
  version move, and the version is part of the validation cache fingerprint,
  so results cached under 0.6.10 could be served for the changed behaviour.
- Write the file extension Node needs on every relative import in the package
  source. The published modules are ES modules that Node resolves by filename,
  and the build had been adding the extensions afterwards with a regex pass
  over `dist`. That pass also re-pointed a specifier silently whenever a file
  moved. The emitted output is unchanged — all 708 modules and their
  declarations are byte-identical to the previous build. Validator 0.6.34.
- Scoped runtime retirement drops only matching tenant entries. Active leases
  retain their runtime while later requests acquire a fresh scoped instance.
- Require `@records-fhir/validation-types` 0.1.11 or newer for native Node ESM
  resolution across its public entrypoints.
- Single-aspect and batch validation resolve the same internal executor
  dependencies and return only requested semantic aspects. Incomplete required
  dependencies cannot become an empty valid result.
- Profile attribution now precedes severity and advisor policies. Active and
  suppressed evidence retains its semantic aspect through embedded resources.
- Cancellation drains admitted aspect and resource work before releasing the
  validation call's capacity.
- A profile constraint declaring `severity: warning` is now reported as a
  warning. Every non-`dom-` warning constraint was demoted to information,
  which diverged from the reference validator on every fixture carrying one.
  `dom-6` keeps its demotion, since the reference validator also treats that
  narrative best-practice rule as advisory. **Consumers gating CI on warning
  counts should expect movement**; the findings themselves are unchanged, only
  their severity.

### Removed

- Two unreachable modules: `parity-mode-filter.ts`, which nothing has
  imported and whose informational suppression only matched one of the two
  severity spellings in use, and `loadFromSource`, a second filesystem
  profile scanner with no callers.
- The `invariant` toggle is gone from the validation settings. It named an
  aspect that never carried a finding: everything it gated reports as
  `structural`, and generic FHIRPath constraints report as `profile`. The key
  stays accepted so stored settings still load, and the label says it is
  retired.
- The undocumented `ValidationContext`-envelope `validate()` wrappers on
  `ReferenceValidator` (`./reference`) and the `string | ValidationContext`
  overload on `MetadataValidator` (`./metadata`). Both classes keep
  `validateInternal(resource, resourceType, ...)`, which is what every
  production call site and example uses; the envelope built a
  `ValidationResult` that nothing consumed. The engine's own
  `ValidationContext` (root export, from `core/validator-engine`) is
  unaffected.
- The internal `types/` boundary module. Its documented purpose — one file
  concentrating the engine's `@shared` imports before extraction — ended when
  extraction happened; it had become a pure passthrough of five
  `@records-fhir/validation-types` types. Engine files now import those
  directly.

### Fixed

- Check slice-scoped constraints on the selected slice instances and retain
  terminology checks for required bindings.
- Validate SNOMED identifiers and UCUM suggestions without accepting misleading
  display fallbacks or inventing corrected units.
- Resolve an unversioned canonical to a pre-release profile when the cache
  holds no released version of it. A ballot implementation guide ships only
  pre-release StructureDefinitions, and refusing them reached no safer profile
  — it fell back to the base resource and reported the profile as
  unresolvable while it sat in the package the reader had installed. The rule
  that a pre-release must not displace a release stays, and now holds across
  packages regardless of version ordering, so `1.0.0-ballot` no longer outranks
  `0.9.0`; the hard-coded exception that had been added for one EU guide is
  gone with it. Measured on the EU Hospital Discharge Report guide
  (`hl7.fhir.eu.hdr#0.1.0-ballot`): 672 "could not be resolved" warnings across
  336 documents became 336 profile conformance errors that were previously
  invisible. Validator 0.6.35.
- Stop the offline display table from refuting a display it merely does not
  recognise. The table lists a handful of codes per system and was treated as
  the complete designation set, so a legitimate SNOMED CT synonym of
  `322236009` became 30 errors. It may now only confirm, except for LOINC,
  where the entries are curated against the terminology server as the full
  designation set for the codes they list; elsewhere an unrecognised display is
  a warning that this validator could not confirm it, and the message no longer
  names a "valid display" it cannot know. Validator 0.6.35.
- Stop substituting `http://hl7.org/fhir/StructureDefinition/<type>` where the
  caller named no profile. For the engine an explicit profile is an
  instruction, so it stops looking: the invented base canonical outranked the
  resource's own `meta.profile` and every profile the specification mandates
  from its code. An Observation declaring `heartrate` and missing the category
  that profile requires reported nothing; it now reports
  `Observation.category has too few values`, and so does the same resource
  with no declared profile, because R4 mandates `heartrate` from LOINC 8867-4.
  Affects the CLI and bundle entry validation. Validator 0.6.35.
- Resolve `QuestionnaireResponse.questionnaire` inside the Bundle that carries
  the response before asking anything else. A transaction Bundle that posts a
  Questionnaire under `urn:uuid:…` and answers it in a later entry warned
  `questionnaire-reference-not-resolved` and skipped every item check, because
  the lookup only knew the questionnaire registry and the package source, and
  a Questionnaire without a `url` can be found in neither. The enclosing
  Bundle's entry index, the one literal references already resolve against,
  now answers a canonical by entry fullUrl, by `Questionnaire.url` (with
  `|version` when pinned) or by `Questionnaire/id`, on the single-resource and
  the multi-aspect path alike, so the response items are validated against the
  bundled definition. Validator 0.6.33.
- Stop requiring a `fullUrl` on a bundle entry that POSTs its resource.
  `Bundle.entry.fullUrl` states it plainly: "The fullUrl element SHALL have a
  value except that: fullUrl can be empty on a POST" — the entry creates the
  resource, so there is no URL for it yet. Every POST entry of a transaction or
  batch bundle that left it out was reported as an error. A relative reference
  inside such an entry is still unanchored and is still reported.
  Validator 0.6.29.
- Open the file a package index names instead of guessing well-known filenames
  in every candidate package. Resolving one bundle's terminology read 164 files
  and 43.8 MB, `CodeSystem-v3-ActCode.json` eight times at 1.45 MB each, only
  to compare the `url` each one carries. The canonical index now records where
  each canonical lives and at which version, so the best candidate is chosen
  from the index and one file is opened. Validator 0.6.24.
- Record one declaration per package however many roots reach it. The bundled
  store is reachable through a symlinked second root and the same packages are
  installed in `~/.fhir/packages`, so every declaration was held two or three
  times — a stored index of 23.9 MB for the 10.7 MB it describes, and the same
  file read as many times. Validator 0.6.24.
- Keep the stored canonical index out of its own signature. Writing it into a
  package store changed the directory signature that had just been computed,
  so every process built the index, wrote it, and then re-read it twice before
  answering. Only package directories are signed now. Validator 0.6.24.
- Keep one stored canonical index per package store instead of one per store
  set. The file already names the set it describes and is rejected on read when
  that set changed, so the digest in the filename bought nothing: a run of the
  test suite left 56 files and 126 MB in the bundled store, none of them ever
  read again. Files an earlier build wrote are removed on the next write.
  Validator 0.6.25.
- Do not store an index that names a temporary package store in a lasting one.
  That directory is gone by the next start, so the index can never be read
  back, and writing it only replaced the file the lasting stores can still use.
  Validator 0.6.25.
- Look a ValueSet or CodeSystem canonical up in one index instead of walking
  every installed package. A canonical the stores do not hold cost a full pass
  over all of them — 648 ms against the 53 bundled packages, of which 323 ms
  was reading the five packages that ship no `.index.json` file by file —
  while one that is found cost 26–39 ms. The negative cache kept each canonical
  from paying twice, but a resource family touching a dozen unknown canonicals
  paid seconds before validating anything. One index over all packages, built
  from `.index.json` where a package ships one and by reading its files where
  it does not, now answers both cases: a miss drops from 648 ms to about 10 ms
  and a hit from 26–39 ms to 13–17 ms. It is rebuilt when any package's
  directory changes. Validator 0.6.20.
- Stop reporting `terminology-system-undetermined` for a code bound below a
  Coding. A profile may bind `X.coding.code` rather than the CodeableConcept —
  MII and other IGs do this routinely — and the binding walk then sees the bare
  primitive. Its system is not unknown: it sits on the sibling `Coding.system`.
  Claiming otherwise raised an **error** on resources whose Coding plainly
  carries a system, whenever the code itself could not be verified locally
  (any unversioned SNOMED code, for instance). A Coding that genuinely carries
  no system is still reported, as `terminology-coding-missing-system`.
  Validator 0.6.18.
- Read a CodeSystem hierarchy from a parent-naming property, not only from
  nested concepts. HL7 Terminology ships every v3 CodeSystem flat —
  `v3-ActCode` is 1 300 concepts, each carrying `subsumedBy` — so a
  `concept is-a <code>` filter selected nothing but the code itself. Every v3
  ValueSet built that way, `v3-ActEncounterCode` among them, expanded to
  nothing locally and went to a terminology server for an answer the installed
  package already held, or came back `unverified` when none was reachable.
  Validator 0.6.26.
- Stop reporting an intact extension as `profile-extension-not-found` when its
  definition could not be loaded. `isResolvable` answered `false` for both "no
  such definition" and "the loader threw", and the caller turns that into a
  finding — an error for a `modifierExtension`. Resolution is now tri-state and
  an undetermined answer withholds the finding; a genuinely unresolvable URL
  still reports as before. Validator 0.6.17.
- Remark once that an HL7-defined CodeSystem leaves concepts without a
  definition, instead of once per concept. The message is about the code
  system — "should ensure that *every* concept has a definition" — so repeating
  it per concept turned one remark into 1 300 on something the size of
  `v3-ActCode`. It is now stated against the first concept that lacks one, as
  the reference validator does; conformance similarity for the `tx` module
  rises from 96.5% to 98.5%. Validator 0.6.28.
- Gate the base-spec invariants on the structural aspect on both paths. The
  batch path already ran `ele-1`, `pat-1`, `dom-2` and the `obs-*` checks
  whenever structural was requested — `resolveSemanticAspectPlan` adds the
  executor for it — while the single-resource path ran them only when the
  `invariant` aspect was enabled. The same resource therefore validated
  differently depending on which path saw it, and switching `invariant` off
  removed findings from the `structural` bucket they are labelled with. The
  executor's own failure issue is labelled `structural` too now, so it lands
  where its findings do. Validator 0.6.22.
- Apply the core Observation profile a vital-sign code mandates *beside* the
  declared one instead of dropping it. R4 requires the profile its code
  implies, and the reference validator evaluates it even when `meta.profile`
  names something else — its expected outcome for `obs-vs-1` reports the `bp`
  error although the resource declares `average-smbp`. Records evaluated only
  what was declared, so an Observation carrying LOINC 8480-6 under
  `vitalsigns` reported nothing at all; it now reports the two missing `bp`
  components and the `value[x]` that profile forbids. The extra pass
  contributes only what the declared pass did not already report, and cannot
  recurse, because its own applied profile is then the mandated one.
  Validator 0.6.36.
- Read a package whose `.index.json` leaves its files unnamed. An index that
  does not account for every file in the package says nothing about what those
  files hold, yet an empty one was read as "this package declares nothing" and
  hid the resources beside it — two installed packages ship `"files": []` next
  to 25 resources, one of them the only copy of a ValueSet in its store. Such a
  package is now read from its own files, the way the profile walker has always
  treated a partial index. Validator 0.6.27.
- Store the terminology canonical index so a process start does not rebuild it.
  Building it reads every package index and every file of the packages that
  ship none — 82.6 MB across 2 895 files, about a second against the stores
  this repo installs. The same index serialises to about 10 MB and parses in 14 ms, so a start
  that finds a valid file spends ~80 ms instead. Identity is the
  package manifests, not directory mtimes, because a container image COPY
  rewrites mtimes although the package content is immutable — the same reason
  the profile loader's persistent index uses them. Writing is best effort and
  tries each store in turn, so a read-only or absent one simply means the index
  is rebuilt next start. Validator 0.6.23.
- Read the profile a package index names instead of every file in the package.
  Returning one StructureDefinition from `hl7.fhir.r4.core` read all 4 583 JSON
  files and 37 MB, although the 1.2 MB `.index.json` beside them already
  carries the URL, version and filename of all 658 profiles — it was used only
  as a negative filter, never to find anything. The first validation of a
  single resource dropped from 8 980 file reads (160 MB) to 1 976, and a cold
  pass over 29 ISiK fixtures from 14.5 s to 9.3 s. A package that ships no
  index, or an index that omits the canonical, still falls back to the full
  read, so nothing becomes unreachable. Validator 0.6.21.
- Say so when a package directory cannot be listed, instead of answering as if
  it held nothing. Two read paths still swallowed the failure: the package
  selection that decides which installed versions to scan, where "no content"
  drops the package entirely and an installed IG stops resolving, and the
  ValueSet scan of a package that ships no `.index.json`, where the canonical
  then resolves from a lower-ranked store or not at all. Both now report the
  errno once per directory, as the other store readers already do.
  Validator 0.6.31.
- Point an unresolvable-CodeSystem remark at `Coding.system` instead of
  `Coding.code`. Nothing was found to check the code against, so the remark is
  about the system — which is where the other producer of the same issue code
  already put it, and where the reference validator puts it. The same finding
  therefore used to land on two different elements depending on which path
  produced it. Conformance similarity for the `tx` module rises from 98.5% to
  99.6%. Validator 0.6.32.
- Resolve child-path slicing references and provide contained/bundle-local
  reference resolution consistently for single-resource validation. Validator 0.6.37.
- Update UCUM parsing to 7.1.8, including valid prefixed units such as `pH`
  (picohenry), which is distinct from the acidity unit `[pH]`.
- Report an inverted `Range` / `RatioRange` (`rng-2`, `ratrng-2`). Neither
  version reached the rule through FHIRPath: R5+ states it with
  `lowBoundary()`, which fhirpath.js rejects for Quantity input, and R4's
  `low <= high` answers `true` for two unit-less Quantities. The bounds are
  now compared directly — as written on R4, over precision boundaries on
  R5+ — and the pair is left alone when the two units are not the same
  scale. Validator 0.6.14.
- Count a constraint that produced no verdict. `skippedConstraints` only
  counted the two failures the classifier could name, so a constraint whose
  expression crashed the FHIRPath compiler — R6's `csd-6` uses
  `defineVariable()`, which fhirpath.js does not implement — was left out of
  the number that is supposed to answer how much went unchecked. Those
  failures are now recorded under a fourth reason, `evaluation-error`, and
  the `profile-constraint-evaluation-error` issue carries
  `validationStatus: 'incomplete'` so the quality lanes read it as unverified
  rather than advisory. Validator 0.6.15.
- Classify `profile-not-resolved` as a setup finding in the EPS quality lane.
  A declared profile that could not be resolved is the same installation
  problem as `profile-not-found`, but only the latter was listed, so a
  missing package read as ordinary advisory noise.
- Say when the profile loader could not read a package store or a package
  file. `loadFromLocalCache` swallowed both, so an installed profile behind a
  permission or I/O failure resolved exactly like one that was never there,
  and a broken profile JSON dropped out of the package index without a word.
  Both now go through the package-store diagnostics, which stay silent for a
  store that is simply absent and cap how much one broken store can log.
  Validator 0.6.16.
- Report a profile that could not be loaded instead of treating it as absent.
  The loader already answers `null` for a profile that is not there, so a
  thrown failure means something else — an unreadable store, a definition that
  did not parse. Both used to collapse into "no profile", which silently
  skipped every snapshot-based structural check and returned a result that
  looked cleaner than it was. The new `profile-unreadable` issue carries
  `validationStatus: 'incomplete'` at `warning`: the resource is not known to
  be wrong, only unchecked. The same now applies to an unloadable
  `compliesWithProfile` claim, which previously dropped its compliance check.
- Stop reporting a valid root property as `structural-unknown-element` when the
  resource's base definition could not be loaded. The base-path check answered
  `false` for both "not in the base" and "could not read the base", and it runs
  only at the root, where the issue is not downgraded — so a transient loader
  failure produced an error-severity finding on a correct resource. The check is
  now tri-state and an undetermined answer withholds the finding and says so
  once per resource type.
- Decide FHIR Schema graph slices whose discriminator depends on the reference
  target by dereferencing it, instead of declaring every `resolve()`-
  discriminated required slice unmatchable. `validateResourceWithGraph` takes
  an optional `resolveReference`; without it such slicing stays unverifiable
  rather than being reported as a missing slice, which is what the
  StructureDefinition runtime already does. Closed slicing and slice maximums
  are now decided from the same resolved evidence.
- Report a questionnaire `regex` constraint that does not compile instead of
  silently accepting the answer, as `questionnaire-sdc-regex-unevaluable`. An
  author's broken pattern previously turned into "the answer is fine".
- Warn once per uncompilable advisor rule `messageRegex` instead of letting the
  rule quietly never match.
- Resolve ValueSets and CodeSystems from the host's tenant packages before
  the filesystem stores, so bindings to an installed IG that no public
  terminology server knows (UK Core) are verified instead of reported as
  unverified. The ValueSet validator binds to the tenant scope through
  `setSourceContext`; hosts answer through the existing
  `findCanonicalResource` capability.
- Resolve the profile behind a slice's type in the validated FHIR release
  instead of always as R4, so R5/R6 resources no longer inherit R4
  cardinalities and constraints through their slices.
- Keep the base resource's element order in generated snapshots and place
  added elements and slices inside their parent's subtree in declared order,
  instead of sorting the snapshot by path; `ordered` and `openAtEnd` slicing
  were judged against the sorted order.
- Ask the terminology server to infer the code system for bindings on
  string and code elements, so `$validate-code` answers instead of rejecting
  the system-less request.
- Ask every other enabled terminology server of the release when the routed
  server cannot resolve a value set, so bindings to licensed VSAC and USPS
  value sets are verified instead of reported as unverified.
- Preserve host-selected profile provenance through batch and direct aspect
  validation, including inferred-profile signposts and governance evidence.
- Resolve ValueSet bindings from the owning package's actual resource version
  and retain wildcard CodeSystem lookups.
- Require explicit custom-rule activation and an image `src` for narrative
  content. Keep date plausibility independent of the current calendar year.
- Evaluate nested `memberOf()` constraints in their element context and leave
  quoted FHIRPath text untouched when rewriting type operators.
- Preserve versioned compliance claims, datatype issue locations and contained
  reference checks inside Bundle entries. Keep terminology coverage failures
  distinct from rejected codes and avoid ambiguous subsumption cache keys.
- Follow installed transitive package dependencies when collecting canonical
  pins. Decode JSON string patch values and reject removal of absent fields.
- Install the composite action runtime in its own checkout and match complete
  file globs, including filename prefixes and recursive directories.
- Stopped emitting unfilled message placeholders. A template rendered with
  whatever the call site passed, so anything it omitted reached the reader
  verbatim: `Structural validation failed: {error}`, `Slice validation failed:
  {error}`, `Element {element} has too few values`. A missing detail now
  shortens the message instead of corrupting it — the detail clause carrying
  the placeholder is dropped whole, because half a clause reads worse than
  none. Fully substituted messages are unchanged.
- Resolved `resolve()` discriminators that step through a child. Only a path
  starting with `resolve()` followed the reference; `item.resolve()` was
  evaluated as a literal element path, matched nothing, and under closed
  slicing every entry was reported as unmatched with all required slices
  missing. The Reference is now read at `item`, resolved, and its target
  matched against the type constraint declared on `item` in each slice — so
  `List.entry` sliced by what `item` points at assigns a contained Condition
  and a contained Observation to their slices. A reference that cannot be
  resolved leaves the slicing unverified rather than failed.
- Resolved contained and bundle-local references for a single resource passed
  to `validate()`. Batch validation and bundle-entry recursion built that
  resolver; the top-level single-resource path did not, so a `#id` reference
  used by a discriminator counted as unresolvable there. A caller-supplied
  resolver still answers everything the resource itself does not contain.
- Resolved slice discriminator evidence through `type.profile` references. A
  slice may delegate its definition to a named slice inside another profile,
  naming it with the `elementdefinition-profile-element` extension. That
  reference was not followed, so the discriminator counted as unresolvable and
  required slices were never checked — `Composition.section` slices declared
  through a section library reported nothing at all. Differentials are not
  required to carry element ids, so the referenced slice is delimited the way a
  differential delimits it rather than by id prefix.
- Made FHIR XML input conversion schema-driven. The converter decided
  primitive types and element cardinality from hardcoded element-name tables,
  so any value whose type comes from the definitions rather than its name
  converted wrongly: `Quantity.value` produced the string `"185.5"` where JSON
  produces the number `185.5`, and a repeating element occurring once became a
  scalar instead of a single-entry array. `StructureDefinition.differential.element`
  was one such element, so XML profiles converted into unusable shapes. Both
  now resolve against the base StructureDefinitions, which is the correct
  source: FHIR JSON array-ness follows the base definition, not any profile
  that narrows it.
- The CLI now passes the selected FHIR release to the XML parser. `--fhir-version
  R4B`, `R5` or `R6` reached validation but not parsing, so the document was
  normalised into the R4 shape first: an R5 `Appointment.participant.required`
  arrived as the string `"true"` rather than a boolean, and every later finding
  was drawn from the wrong definitions.
- Exported `FhirInputDiagnostic` from `@records-fhir/validator/input`, and
  declared the `./input` and `./issues` subpaths. `parseFhirXml` returns
  `diagnostics` typed by an interface consumers could not import.
- Reported a constraint key redefined with a different expression inside a
  StructureDefinition. A key identifies an invariant, so reusing one for a
  different rule means two rules answer to the same name and a reader tracing a
  failure finds the wrong definition. Restating a key with the same expression
  is how a profile carries an inherited invariant forward and stays allowed.
  Keys inherited from the base definition are not yet compared, which needs
  loader access the validator does not have.
- Reported a pinned ValueSet version that was not the one resolved. A binding
  writing `|4.0.0` was quietly satisfied by the bundled `4.0.1` through a
  same-major fallback. The fallback keeps validation working and stays, but
  substituting a different version without saying so hides which definition a
  finding was actually checked against.
- Raised a duplicate security label from information to an error, and replaced
  the "unknown security system" finding with what is actually wrong. Security
  systems were checked against a hardcoded shortlist, so an unlisted system
  reported only that Records had not heard of it. Two things are wrong: the
  code system cannot be resolved, so the code cannot be checked at all, and the
  label is therefore not known to be in the bound value set.
- Raised an undefined element in a primitive extension sidecar from a warning
  to an error. An element the definitions do not describe is a structural
  defect, and the reference validator reports it as one.
- Reported that a bare code's system could not be determined, alongside the
  binding violation itself. A `code` with no system fails twice over: the
  system cannot be established at all, and the value is not in the value set.
  The reference validator reports both, and they are different facts — the
  first says the code could not even be looked up.
- Reported every way a `pattern[x]` is violated, not only the first. The
  matcher returned on its first mismatch, so a missing element hid a wrong
  value sitting beside it and the author only saw the second defect after
  fixing the first and revalidating.
- Resolved a profile's base definition against the release being validated.
  `SnapshotGenerator` passed no version to `loadProfile`, which defaults to R4,
  so a profile validated under R5 inherited the R4 base and its cardinality —
  `Encounter.class` is `1..1` in R4 and `0..*` in R5, so R5 resources were
  reported as missing a required element. Base validation was already
  version-correct; only the profile-driven path was affected.
- Converted FHIR XML decimals written with an exponent. The numeric pattern
  admitted neither `1e1` nor `0.1e11`, so those values stayed strings and the
  validator then reported a type mismatch against the element's own declared
  decimal type — a false positive of the validator's own making. The integer
  types keep the stricter pattern, which is what FHIR specifies.
- Gave R4B and R6 their own XML conversion tables instead of reusing R4 and R5.
  R4B and R4 share 6575 elements but R4B adds 944 and drops 831, and they
  disagree outright on `EvidenceVariable.characteristic.timeFromStart`, a
  `Duration` in R4 and a `BackboneElement` in R4B. The tables are generated as
  deltas against their nearest release, which costs about 13 KB gzipped rather
  than a second full copy each.
- `parseFhirXml` accepts an optional `fhirVersion` (default `R4`). R4 and R5
  disagree on roughly 200 element types and cardinalities — for example
  `Appointment.participant.required` is a `code` in R4 and a `boolean` in R5 —
  so the release has to be stated rather than guessed. Element names the
  definitions do not describe still fall back to the previous heuristics, so
  logical models and custom resources are unaffected.

## [0.6.2] — 2026-08-25

Patch release closing Bundle, XML, and SNOMED edition gaps and adding
reproducible release evidence for every supported FHIR release. There are no
intentional breaking changes.

### Fixed

- Restored terminology and binding validation for resources nested in Bundle
  entries. Duplicate parent/child findings are collapsed without losing the
  resource-qualified path needed to locate the failing entry, while findings
  from separate Bundle entry indices remain independent.
- Forwarded `Coding.version` through terminology validation and routed SNOMED
  CT edition URIs only to servers that explicitly advertise the requested
  module through `snomedEditions`; that declaration alone makes the scoped
  server response authoritative. Edition selection is now part of immutable
  runtime snapshots and terminology cache keys, authoritative negative
  responses remain invalid, and deep datatype traversal preserves the requested
  version. ValueSet binding delegation sends `systemVersion`, version-specific
  package loads cannot replace the unversioned CodeSystem cache, and
  release-incompatible defaults fall back to an enabled generic server. A
  missing edition route emits an actionable diagnostic instead of silently using
  the wrong server.
- Hardened FHIR XML conversion and the conformance resource loader so
  namespace-aware XML resources, manifest inputs, and supporting resources use
  the same bounded parser and reach validation as proper FHIR JSON objects.
  Invalid leading-plus numeric lexemes stay visible to structural validation,
  and repeating primitive sidecars remain aligned with their missing values so
  `mustHaveValue` and `valueAlternatives` apply per occurrence.

### Quality

- Added explicit JSON/XML and R4/R4B/R5/R6 conformance lanes, including small
  clean and defect corpora for R4B and R6.
- Added a reproducible validator performance baseline and a regression gate
  with absolute ceilings, noise-floor handling, and report provenance checks.
- Added FHIRSchema dual-path report freshness and provenance gates. The release
  keeps StructureDefinition validation authoritative; FHIRSchema remains an
  evidence-only comparison path until independently confirmed gaps justify a
  runtime change.
- Fixed the public-repository export boundary so its policy module is included
  and the exported tree executes the privacy audit during regression tests.

## [0.6.1] — 2026-08-24

Patch release keeping clinical content out of persisted findings.

### Fixed

- Removed the offending value from `string-whitespace-padding` and
  `date-year-implausible`. Both findings are persisted verbatim in the issue
  message and details, so a padded `Patient.name.family` stored a patient name
  and an implausible `birthDate` stored a full date. The padding finding now
  reports where the whitespace sits and how wide it is, and the year finding
  reports the year and the plausible range — enough to locate and fix the
  defect without copying the data. Values are deliberately kept for
  `decimal-value-out-of-range`, `language-code-invalid` and the terminology
  codes: those are malformed numbers, language tags and codings rather than
  well-formed clinical text, and the value is the finding.
- Dropped the `string-whitespace-padding` patch template, which filled itself
  from the removed trimmed value; the guidance remains and clients hold the
  resource needed to trim it.

## [0.6.0] — 2026-08-23

Minor release from a differential-fix campaign: the validator was run against
official IG package examples, live public FHIR servers, a mutation corpus, and
the HL7 `fhir-test-cases` suite, and every divergence from the reference
validator was arbitrated against it. Results become more precise in both
directions — new detections appear, and several classes of false positive
disappear. The public API only grows; there are no intentional breaking
changes, but consumers gating CI on issue counts should expect movement.

### Added

- Added bounded public FHIR XML and NDJSON input adapters and CLI discovery for
  `.json`, `.xml`, and `.ndjson` files. XML parsing is namespace-aware, rejects
  DTD/entity declarations, preserves primitive extensions, contained
  resources, XHTML narratives, and source locations; NDJSON applies total,
  per-line, and record-count limits.
- Added `resolveFhirReleaseContext()` so R4B keeps the explicit
  `hl7.fhir.r4b.core#4.3.0` package identity and documents its current R4
  validation/FHIRPath maintenance-adapter boundary.
- Added the R4B core package to the default reproducible bundled-profile plan.

- Validated extension usage against the `context` declared by the extension's
  StructureDefinition (R4/R5 and legacy DSTU3 forms, wildcards, element paths,
  and choice elements), reported as `profile-extension-context-wrong`.
- Evaluated core datatype invariants (rng-2, qty-3, rat-1, sdd-1, tim-*, cpt-2
  and siblings) during the complex-type walk.
- Added the txt-2 narrative-content rule, plausibility lints for implausible
  years and out-of-range decimals, BCP-47 language-code validation, attachment
  content and att-1 checks, and a padded-string lint — each matched to the
  reference validator's own bounds.
- Emitted an informational signpost naming the profile a code-inferred
  vital-signs application came from, and attributed the resulting findings to
  the profile aspect instead of the base spec.
- Detected elements matching more than one sibling slice
  (`profile-slice-ambiguous-match`) with reference-validator wording.
- Exported `BestPracticeValidator` / `validateBestPractices` and the
  `matchCodeInferredProfile` helper.

### Fixed

- Restored the custom FHIRPath function table used by element constraints: two
  invalid arity entries had silently invalidated the whole table since its
  introduction, so `extension()`, `resolve()`, `memberOf()`, `conformsTo()` and
  `subsumes()` never ran. `resolve()` on unresolvable references and the `is`
  operator now propagate empty exactly as the reference validator does.
- Closed eight independent slicing-discriminator gaps: value-set membership
  semantics, type discriminators on `$this` and on paths, datatype-profile
  discrimination, primitive-code bindings, profile ancestry, resliced repeats,
  FHIRPath function segments, and integer-family value shapes.
- Validated primitives under repeating inline components (`Dosage.doseAndRate`,
  DataRequirement filters, R5 `Availability`) and inside
  `Parameters.parameter.resource`, which the element walk had skipped.
- Resolved `contentReference` targets in declared-profile walks, restoring type
  information for recursive elements such as `QuestionnaireResponse.item.item`.
- Honored IG dependency version pins when resolving unversioned canonicals, and
  made package-store selection deterministic: exact pins win, cross-major
  fallbacks are refused, configured stores outrank the user cache, and core
  packages stay authoritative for core canonicals.
- Kept locally resolvable terminology checks running while terminology servers
  are unavailable, and degraded required-binding misses to unverified when a
  value set's includes cannot be materialised locally.
- Aligned severities and acceptance with the reference validator for unresolved
  extensions, LOINC display designations, `<a name>` narrative anchors,
  searchset `include` entries, relative URIs in plain-uri slots, bare-token
  references (accepted standalone, rejected inside bundles), `fullUrl` REST
  identity, cross-version extension URLs, and terminology-package precedence.
- Replaced the remaining generic `invalid` issue codes with named ones.

### Changed

- Raised the custom-rule source load budget from 250ms to 2s. Cold tenant
  rule loads traverse an organization-scoped transaction with several
  database round trips on hosted infrastructure and regularly exceeded the
  old budget, emitting false `custom-rule-source-unavailable` warnings; the
  bound still fails the aspect closed when the source is genuinely
  unavailable.

### Security

- Prevented XML DTD/entity expansion, foreign XML namespaces, unsafe object
  property names, and unbounded XML/NDJSON input growth.

## [0.5.0] — 2026-07-23

Minor release expanding reference-compatible profile, contained-resource,
slicing, and terminology behavior. Validation results can become more precise
for resources that previously fell back to a base profile or emitted redundant
findings; there are no intentional breaking changes to the public API.

### Added

- Applied the FHIR-implied core Observation profile when recognized LOINC or
  SNOMED CT codes identify vital signs and no explicit profile was supplied.
  The matching policy is available through the new public
  `inferCodeBasedProfiles()` helper.
- Validated contained resources in the multi-aspect path, including contained
  reference resolution, parent-relative issue paths, applied-profile evidence,
  and deterministic issue identities.
- Added the explicit `@records-fhir/validator/validators/fhirpath-sandbox`
  package subpath alongside the existing root export.
- Added focused regression coverage for complex slicing discriminators,
  extension invariants, terminology bindings, contained resources, attachment
  content, choice types, URI primitives, XHTML, and reference targets.

### Changed

- Hardened the composite GitHub Action by pinning `actions/setup-node` to an
  immutable commit and validating `validator-version` before passing it to npm.
- Reported code-inferred profile application through the shared
  `ProfileApplicationSource` contract.
- Coalesced identical asynchronous terminology work within one configuration
  epoch while preserving cache invalidation between epochs.

### Fixed

- Aligned nested and differential-only slice matching for value, pattern,
  profile, reference, and complex child discriminators without hiding closed
  slicing failures.
- Corrected required and extensible terminology binding behavior for local
  CodeSystems, composed ValueSets, display validation, external CodeSystem
  references, and unavailable membership evidence.
- Preserved extension and element constraint context across nested profiles,
  optional fixed children, and repeated elements.
- Removed redundant structural, profile, metadata, and invariant findings while
  retaining the most specific issue code, path, profile, and rule evidence.
- Hardened attachment, Bundle fullUrl, CodeSystem property URI, narrative
  XHTML, Questionnaire, reference target, tag, and primitive URI validation.

### Verification

- Passed validator and validation-types typechecks and builds, package
  dry-runs, the OSS boundary audit, package smoke test, and publish-workflow
  dry-run.
- HL7 JSON parity: 536/536 (100.0%), 0 failed, 0 skipped, 0 errors.
- MII 2026 reference parity: 231/231 measured (100.0%), 22 classified skips,
  128/128 profiles prewarmed, and 0 FHIRPath constraint skips.
- FHIR Schema dual path: 555 fixtures, 0 Records-only cases, 0 divergent cases,
  and 0 actionable Java-confirmed runtime gaps.

## [0.4.4] — 2026-07-21

Patch release hardening production metadata validation and terminology
expansion without changing the public validation API.

### Fixed

- Replaced runtime directory imports with explicit ESM entry files so packaged
  metadata validation works in the production Node.js container.
- Propagated metadata-engine exceptions to the host instead of representing
  runtime failures as FHIR resource findings.
- Traversed hierarchical terminology-server `$expand` results recursively, so
  nested valid codes such as Questionnaire item types are recognized.
- Accepted malformed primitive `meta` input as a normal structural metadata
  finding instead of allowing completeness checks to throw.

### Verification

- HL7 JSON parity: 536/536 (100.0%), 0 failed, 0 skipped, 0 errors.
- MII 2026 reference parity: 231/231 measured (100.0%), 22 classified skips,
  128/128 profiles prewarmed, and 0 FHIRPath constraint skips.
- Verified the packed public package by executing real metadata validation and
  rejecting any internal-error or directory-import finding.

## [0.4.3] — 2026-07-21

Patch release completing the executable HL7 JSON and scoped MII 2026 parity
lanes while hardening version-aware validation behavior.

### Changed

- Completed all 536 executable HL7 JSON comparisons against the pinned Java
  `OperationOutcome` baselines with zero runtime skips or parity differences.
- Revalidated the full MII 2026 reference corpus at 231/231 measured matches,
  with the existing 22 explicitly classified out-of-scope/reference skips.
- Kept tenant-hosted custom rules outside the standalone MII reference lane so
  infrastructure availability cannot be misclassified as a clinical delta.
- Updated the pinned HL7 `FHIR/fhir-test-cases` manifest to
  `8923095fc5e3750025f7dd71988c9e89083b1487` and removed obsolete Java-outcome
  path and synthetic-baseline workarounds.

### Fixed

- Preserved the requested FHIR version for nested complex-type terminology
  bindings, preventing R5/R6 package content from contaminating R4 validation.
- Fixed versioned snapshot eviction and legacy id-less slice scoping so cached
  validation remains deterministic regardless of case order.
- Aligned structural validation for primitive sidecars, repeating elements,
  invalid StructureDefinition paths, QuestionnaireResponse reference types,
  CodeSystem metadata, XHTML language attributes, and rendering XHTML.
- Normalized reference-harness parser and legacy fixture behavior only where
  the Java baseline represents harness/runtime behavior rather than a FHIR
  resource rule.

### Verification

- HL7 JSON parity: 536/536 (100.0%), 0 failed, 0 skipped, 0 errors.
- MII 2026 reference parity: 231/231 measured (100.0%), 22 classified skips,
  128/128 profiles prewarmed, and 0 FHIRPath constraint skips.
- Verified with focused regression tests, validator typecheck/build, package
  dry-run, parity gates, and standalone public-export checks.

## [0.4.2] — 2026-07-05

Patch release for validator architecture boundaries, evidence policy, and
maintainability after the 0.4.1 evidence release.

### Added

- Added stable `host` and `conformance` package surfaces for embedding and
  evidence tooling, keeping repository consumers off deprecated implementation
  subpaths.
- Added `dedupeIssuesWithTrace()` so duplicate-suppression decisions expose the
  named policy rule that removed an issue.
- Added an explicit FHIR Schema runtime policy export that keeps the graph path
  evidence-only until Java/reference and dual-path gates justify promotion.

### Changed

- Hardened public-export and mirror-import architecture guards so new internal
  validator exports or repository imports fail fast.
- Split terminology remote CodeSystem budget handling out of the API client and
  kept the fail-open budget reason traceable.
- Split remote CodeSystem budget aggregation tests into focused coverage.

### Documentation

- Documented validator fallback, fail-open, fail-closed, legacy compatibility,
  and release-gate guardrails.

### Verification

- Verified with merged PR #252 CI, main CI, validator build, OSS boundary audit,
  OSS package smoke, architecture guards, focused Vitest suites, and npm publish
  dry-run.

## [0.4.1] — 2026-07-01

Patch release for the standalone validator evidence lanes and MII reference
workflow. Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added validator claim summary generation for publishing the current HL7,
  MII reference, and FHIR Schema dual-path evidence in one machine-readable
  artifact.
- Added FHIR Schema dual-path action reporting so unconfirmed graph/reference
  buckets remain explicit follow-up work instead of hidden parity debt.
- Added package-backed terminology diagnostics and local terminology server
  helpers for deterministic MII/FHIR Schema quality lanes.

### Changed

- Hardened the MII reference triangulation workflow with reference-health
  probes, policy-rule extraction, skip taxonomy, and failed-profile prewarm
  details.
- Refreshed the public validator documentation around the 2026-07-01 evidence:
  496/496 HL7 executable JSON comparisons, 231/231 measured MII reference
  parity, and 555-fixture FHIR Schema dual-path coverage.
- Tightened FHIR Schema graph slicing, reference-target extraction, and pattern
  diagnostics while keeping the graph path in parallel evidence mode.

### Fixed

- Fixed MII package relevance detection so package names containing substrings
  such as `isik` are not misclassified as Gematik ISiK packages.
- Fixed nested profile slice scoping and choice/FHIRPath edge cases uncovered
  by the MII and FHIR Schema dual-path lanes.

### Verification

- Verified with repository lint, stable tests, targeted validator Vitest
  suites, full affected conformance, MII reference gate, HL7 parity gate, and
  FHIR Schema dual-path report generation.

## [0.4.0] — 2026-06-30

Runtime slicing and evidence-gate update for the standalone validator and
GitHub Action. Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added runtime support for differential-only slices that inherit slicing from
  their base or snapshot when slice elements do not redeclare slicing locally.
- Added local-first FHIR Schema dual-path evidence reporting with exported
  normalization helpers for comparing Records, graph-derived validation, and
  Java OperationOutcome baselines.
- Added focused regression coverage for required slices, closed slicing,
  `memberOf` prechecks, and FHIR Schema StructureDefinition merge behavior.

### Changed

- Merge differential and base StructureDefinition elements by slice-aware
  identity instead of path alone, keeping same-path slices from sharing
  cardinality or metadata by accident.
- Normalize known equivalent closed-slicing diagnostics in the evidence lane so
  Java pattern differences are measured without hiding real parity gaps.
- Refresh README evidence around the current MII/ISiK triangulation signal and
  scoped FHIR Schema dual-path status.

### Fixed

- Fixed required-slice detection for profiled differential-only slices where
  the slice exists in the differential but the slicing declaration is inherited.
- Fixed local terminology/memberOf precheck diagnostics so missing local
  expansions produce stable validation signals without depending on remote TX
  availability.

### Verification

- Verified locally with validator typecheck/build, targeted Vitest suites, MII
  reference gate, validator performance gate, and repository lint.

## [0.3.0] — 2026-06-23

Release-hardening update for the standalone validator and GitHub Action.
Released with `@records-fhir/validation-types` 0.1.5.

### Added

- Added `recordsValidator.validateAll(...)`, an ordered public batch API that
  returns `index`, `resourceType`, `id`, `isValid`, and `issues` for each input
  while still using the optimized batch path for homogeneous profile/settings.
- Added stable issue-contract helpers:
  `issueFingerprint`, `summarizeIssueFingerprints`, `stableIssues`,
  `issueMatchesAnchor`, and `issuePathMatchesPattern`.
- Added structured terminology diagnostics in `ValueSetValidator.getCacheStats()`
  for unverified bindings and fail-open membership checks.
- Added cold-start, warmup, measured-wall-clock, heap, and peak-RSS fields to
  the local validator performance baseline.
- Added a pinned `FHIR/fhir-test-cases` runner default at
  `431b37cd06cac878bc23b4a8b457c2f2397fdcdc` with an override flag/env var for
  intentional upstream refreshes.

### Changed

- Negative-cache failed FHIRPath constraint-expression compiles so repeated
  unsupported expressions do not pay repeated compile cost.
- Silence HL7 conformance-runner engine logs by default while keeping a
  `--verbose` escape hatch for investigation.
- Refresh README/public-mirror conformance evidence around the pinned
  2026-06-23 local run: 496/496 executable comparisons passed, 40 Java-baseline
  output skips, and 100.0% headline JSON-resource parity.

### Fixed

- Exclude the selected `--output` report path from CLI validation inputs so a
  later folder run does not validate its own previous report.

### Verification

- Verified locally with validator typecheck/build, targeted Vitest suites,
  mirror-import guard, OSS package smoke test, local performance baseline, and
  full pinned conformance against `FHIR/fhir-test-cases`.

## [0.2.0] — 2026-06-23

Production-readiness release for the standalone npm CLI. Released with
`@records-fhir/validation-types` 0.1.5.

### Added

- Added `--output <file>` so CLI runs can write JSON or text reports without
  shell redirection.
- Added `--summary-only` for quiet CI jobs that only need aggregate counts.
- Added repeatable `--include <glob>` and `--exclude <glob>` filters for
  folder validation.
- Documented stable CLI exit codes: `0` for pass, `1` for validation threshold
  failure, `2` for usage/input/output errors.
- Added direct CLI behavior coverage for report output, summary-only mode,
  include/exclude filters, help text, and usage/output error exit code `2`.
- Added a deterministic golden quality-corpus matrix that validates
  representative R4 defect fixtures against `.expected.json` issue anchors
  without reading the developer's global FHIR package cache.
- Added a local validator performance-baseline command with fixture limiting
  and optional mean/p95/p99/worst timing budgets:
  `npm run quality:validator-perf-baseline`.

### Verification

- Extended the OSS package smoke test to install the packed npm package in a
  fresh project and execute the installed `records-fhir-validator` binary with
  output-file, summary-only, include, and exclude options.
- Verified the local release loop with targeted Vitest suites, package
  typecheck/build, mirror-import guard, OSS package smoke test, and the local
  performance baseline.

### Changed

- Typed the public `recordsValidator` singleton facade so public API calls stay
  aligned with the underlying `RecordsValidator` engine signatures.
- Split the CLI implementation into argument parsing, file matching, validation
  execution, shared result types, and output rendering.
- Extracted reusable issue-contract anchors for stable golden-corpus
  assertions.
- Isolated the slicing ValueSet package loader so discriminator binding lookups
  use a private terminology cache and preserve `FHIR_PACKAGE_CACHE_PATH` even
  when dotenv leaves a literal `$HOME` placeholder.
- Tightened CLI JSON-input and issue-rendering types from loose `any` handling
  to guarded `unknown` boundaries.

## [0.1.14] — 2026-06-23

Runtime patch release for the standalone CLI package. Released with
`@records-fhir/validation-types` 0.1.5.

### Fixes

- Pinned the validator runtime dependency to `@records-fhir/validation-types`
  0.1.5 so npm installs include the issue-identity helper exports required by
  the CLI and validation engine.

## [0.1.13] — 2026-06-23

Public usability polish for the standalone validator package and public mirror.
Released with `@records-fhir/validation-types` 0.1.4.

### Added

- Added the `records-fhir-validator` npm binary for local file/folder
  validation, JSON output, FHIR version selection, profile-url selection, and
  configurable CI failure thresholds.

### Documentation

- Reworked the package README and public mirror README around copy-pasteable
  CLI, TypeScript API, and GitHub Action quickstarts.
- Documented structured issue output and clarified the current practical scope
  of the TypeScript validator before broader conformance evidence.
- Updated examples and security docs from the old `@v1` action reference to
  the current `@v0` / `@v0.1.13` release line.

## [0.1.12] — 2026-06-23

Feature release adding FHIR R6 validation. Released with
`@records-fhir/validation-types` 0.1.4. Re-verified green against the HL7
`fhir-test-cases` JSON-resource parity gate.

### Features

- **FHIR R6 validation support** — resources can now be validated against R6
  alongside R4, R4B, and R5.
- **Publication-status escalation** in the strictness layer: issue severity now
  accounts for the publication status of the governing artifact.

### Fixes

- `memberOf()` boolean constraints: added a synchronous fallback so terminology
  `memberOf` checks resolve correctly when async ValueSet expansion is
  unavailable.
- Reduced validation false positives and corrected gate-status reporting.
- Hardened engine contracts and expanded golden-regression coverage.

### Maintenance

- Split `valueset-validator` into cohesive modules (binding, code-system,
  expansion-loader, filter-checks, two-phase-shadow).
- Deduped advisor rules into the validator package; split out the terminology
  server manager.
- Extracted the SD-loader profile-load pipeline, extension FHIR-version filter,
  circular-reference graph builder, and profile→package detection.

## [0.1.11] — 2026-06-01

Patch release for the standalone OSS validator package after the latest Firely
and public-server validation runs. Released with
`@records-fhir/validation-types` 0.1.4.

### Fixes

- Closed the remaining HL7/HAPI validator-CLI capability gaps around profile
  fallback, bundle-entry validation, and multi-aspect strictness handling.
- Preserved code-aware display equivalence checks by passing the full code
  context into display normalization.
- Kept the EHDS EPS package selection stable while retaining the pinned
  transitive reference closure.

### Maintenance

- Refreshed direct runtime dependencies: `axios`, `date-fns`, `fhirpath`, and
  `tar`.
- Verified the package boundary, TypeScript build, and OSS smoke checks before
  publishing.

## [0.1.10] — 2026-05-28

Patch release after the HL7 JSON and MII 2026 parity gates were restored to
100% on the current reference suites. Released with
`@records-fhir/validation-types` 0.1.4.

### Fixes

- Normalized profile source settings so the package engine, server runtime,
  Simplifier/registry loading, and bundled package fallback use the same source
  policy.
- Kept the current EPS preview package pinned while preserving the canonical
  xTeHR reference source, avoiding accidental drift when upstream preview
  packages move.
- Tightened advisor, metadata, reference, strictness, and batch validation code
  paths around the shared runtime settings model.

### Quality

- Restored full HL7 JSON conformance parity against the current
  `fhir-test-cases` checkout: 496/496 run cases pass.
- Restored MII 2026 reference parity against the current MII validator
  container: 241/241 measured cases pass.
- Added CI guardrails so missing bundled FHIR core profiles fail early instead
  of surfacing as broad false parity regressions.

## [0.1.9] — 2026-05-26

Patch release focused on reducing profile/slicing false positives found in
large Firely/ART-DECOR validation runs. Released with
`@records-fhir/validation-types` 0.1.3.

### Fixes

- Preserved inherited slice cardinality correctly when generating snapshots
  from differential-only profiles. This fixes false
  `profile-slice-min-cardinality` errors where a base element minimum leaked
  into an inherited named slice such as `Observation.code.coding:IEEE-11073`.
- Scoped nested extension slice validation so child extension rules only apply
  to the matching parent extension slice.
- Ignored extension slices whose type profiles target another FHIR version,
  avoiding R5 extension requirements during R4 validation.
- Deduplicated profiled extension cardinality and coding-system/value-set
  diagnostics so equivalent constraints do not produce repeated issue rows.
- Improved package detection for Da Vinci Plan-Net, US, UK, AU, Dutch, IHE,
  and universal realm IGs used by large public FHIR servers.

### Quality

- Added regression coverage for inherited slice cardinality during snapshot
  generation and the affected nested/profiled slicing cases.
- Refactored public validator imports and strictness filtering to reduce
  package/server drift without changing the public API.

## [0.1.8] — 2026-05-25

Patch release focused on validation precision and EHDS/large-server readiness.
Released with `@records-fhir/validation-types` 0.1.2.

### Fixes

- Reduced false positives in anomaly, reference, MustSupport, duplicate-event,
  temporal-gap, and clinical coding checks across large FHIR servers.
- Improved terminology behavior for SNOMED, UCUM, display variants, unsupported
  ValueSet filters, inactive-code disagreements, nested ValueSets, and
  CodeableConcept arrays.
- Kept display mismatches and profile-fixed binding diagnostics from becoming
  noisy hard failures when terminology servers disagree or omit optional
  metadata.
- Hardened package/profile resolution around cached package scans, Simplifier
  metadata, Ontoserver responses, and ART-DECOR/HAPI comparison inputs.

### Quality

- Added regression coverage for terminology display variants, inactive fallback
  behavior, duplicate diagnostic reports, value range units, and contextual
  MustSupport skips.
- Reworked validation internals toward explicit resource, issue, pipeline, and
  terminology payload types so the package/server mirror has fewer broad casts
  and less drift risk.

## [0.1.7] — 2026-05-18

Patch release for eHDS document-Bundle conformance and public-package
hardening. Released with `@records-fhir/validation-types` 0.1.2.

### Fixes

- Added document-context validation for eHDS/EPS-style Bundles so Composition
  section entries are checked against their section `targetProfile` contracts.
- Added conformance-aware Bundle entry slice matching, including
  `structuredefinition-imposeProfile` support, so imposed IPS/EPS Composition
  profile requirements produce the same parent-profile and slice-min
  consequences observed in the reference HAPI/MII validator.
- Shared document-context validation between single-resource and multi-aspect
  validator paths to keep package and server behavior aligned.
- Fixed invariant execution context ownership in the package engine and removed
  stale server-side mirror paths that could drift from the OSS validator.

### Terminology and packages

- Hardened terminology/package loading around package download retries,
  filesystem StructureDefinition loading, ValueSet cache behavior, and UCUM
  canonical unit handling.
- Added public validation settings support for `performance.enableDeltaSearch`
  through `@records-fhir/validation-types` 0.1.2.

### Tests

- Added regression coverage for multi-aspect Bundle entry validation,
  document-context targetProfile narrowing, imposed-profile slice consequences,
  SD FHIRPath choice types, slice discriminator matching, package downloads,
  and ART-DECOR document parent parity.
- Added ART-DECOR/HAPI smoke commands and an `ehds-strict` policy gate used to
  keep Records-vs-HAPI semantic deltas actionable.

## [0.1.5] — 2026-05-09

Patch release for terminology slice parity and refreshed conformance evidence.

### Fixes

- Fixed required-binding false positives for missing optional slice roots. The
  terminology executor now leaves absent optional slices to slicing/cardinality
  validation instead of emitting broad `binding-required-missing` diagnostics.
- Fixed slice-descendant binding validation for FHIR choice-type paths such as
  `Observation.component.value[x]`; matching slice values now resolve concrete
  instance keys such as `valueCodeableConcept`.
- Kept the server-side Records validator mirror in sync with the standalone
  package executor.

### Tests

- Added regression coverage for sliced `Observation.component.value[x]`
  bindings using `valueCodeableConcept`.
- Refreshed HL7 `FHIR/fhir-test-cases` evidence: 496/496 executable JSON
  comparisons passed with 35 Java-baseline backlog skips at upstream commit
  `e543043a076c493656fc8008df250659b15d02cb`.
- Refreshed scoped MII 2026 reference parity against the official MII validator
  container: 241/241 measured resources passed, 12 classified corpus/profile
  skips, parity score 100.0%.

## [0.1.4] — 2026-05-06

Patch release for the Firely validation triage and public package
sync.

### Fixes

- Fixed false positives in slice matching for `$this` Coding slices and
  slice child constraints.
- Hardened StructureDefinition loading so R4/R5 core definitions and
  cached package scans do not cross-contaminate validation runs.
- Tightened unknown-property detection so internal enhancer fields and
  valid primitive companion fields are not reported as structural
  errors.
- Improved terminology parity: display comparisons now ignore
  case/whitespace-only differences, missing CodeSystem values are
  warnings, and unvalidated terminology coverage uses stable issue
  codes.
- Improved reference parsing for contained references, absolute URLs,
  versioned references, and Bundle entry contexts.

### Tests

- Added focused regression coverage for StructureDefinition cache
  versioning, unknown-property walking, slice element matching,
  terminology issue classification, and reference format/type
  extraction.

## [0.1.3] — 2026-05-05

Patch release fixing a public-export gap that shipped in 0.1.2. No
behaviour or API changes beyond the missing re-exports being
restored.

### Fixes

- Re-export `applyFixPatch` + `FixApplyResult`, `checkFhirpathSandbox`
  + `SandboxLimits` + `SandboxResult`, and the fix-suggestions
  catalog (`FixSuggestions`, `getFixSuggestion`, `formatFixSuggestion`,
  `createValidationIssue`, `CreateIssueParams`) from the package
  root. In 0.1.2 they existed in subpath barrels only; the
  CHANGELOG and concept docs advertised them as top-level exports
  but a fresh `npm install` of 0.1.2 threw
  `SyntaxError: does not provide an export named 'applyFixPatch'`
  when consumers followed the docs. Caught by an out-of-tree
  smoke test against the packed tarballs after publication.

  Verified against the published tarball: the named exports
  `applyFixPatch`, `checkFhirpathSandbox`, and `getFixSuggestion`
  are present at the package root in 0.1.3.

### Migration from 0.1.2

If you worked around the missing exports with subpath imports:

```ts
import { applyFixPatch } from '@records-fhir/validator/issues';
import { checkFhirpathSandbox } from '@records-fhir/validator/validators/fhirpath-sandbox';
```

…you can switch to the documented top-level form:

```ts
import { applyFixPatch, checkFhirpathSandbox } from '@records-fhir/validator';
```

Both forms continue to work; the subpath imports stay supported.

## [0.1.2] — 2026-05-04

Coordinated release with `@records-fhir/validation-types` 0.1.1.
Bundles the entire 2026-05-03 sprint plus the OSS boundary cleanup,
business-rules subpath exports, and the validator engine extractions
that landed before the bump. Not yet published to npm pending the
license decision (see the `oss-launch-checklist.md` in the source
repo).

### Engine

- `compliesWithProfile` now checks `required`/`extensible` binding
  ValueSet compatibility for `cw-binding-*` fixtures. Simple
  inline/contained ValueSet concept lists are compared directly, so
  `cw-binding-superset` fails correctly while legitimate
  `cw-binding-subset` refinements pass. Falls back to conservative
  URL inequality when expansion is not local and simple.
  Launch-discovery executed comparisons reach 100.0% pass rate
  (547/547) with 0 skips.

### Public API

- `recordsValidator.validate()` and the new `PublicFhirVersion` type
  accept `'R4B'` alongside `'R4' | 'R5' | 'R6'`. R4B routes through
  the R4 internal path (same StructureDefinitions, same FHIRPath
  context) — this matches R4B's status as a maintenance release of
  R4. R4B-specific package bundling (`hl7.fhir.r4b.core`) is tracked
  under K-2.
- `toInternalFhirVersion(v: PublicFhirVersion)` exported for
  embedders that need to route their own internal calls.

### Terminology

- `TerminologyApiClient.subsumes()` is now process-cached with the
  same 15-minute TTL + 5000-entry LRU as `validateCode`. Successful
  outcomes (`subsumes` / `subsumed-by` / `equivalent` / `not-subsumed`)
  are cached; `'unknown'` (server error / malformed response) is
  intentionally not cached so a retry within the TTL can succeed.
  New `clearSubsumesCache()` and `getSubsumesCacheSize()` exports.
- `TerminologyApiClient.isSubsumedBy(system, child, parent)`
  convenience helper. Returns `true` only when the parent strictly
  subsumes the child or is equivalent — the FHIR `$subsumes` argument
  order (codeA subsumes codeB) is easy to reverse and the named
  helper makes the intent at the call site obvious.

### Security

- `checkFhirpathSandbox(expression, limits?)` — static safety
  pre-flight for user-defined Custom Rules. fhirpath.js is
  synchronous and cannot be hard-timed out from the calling thread,
  so the only reliable defence against a pathological customer
  expression is to reject it before it runs. Three bounds:
    - `expressionLength`: 4096 characters
    - `functionCallCount`: 64
    - `nestingDepth`: 16
  String-literal aware: identifiers inside quoted spans don't count
  as function calls. Wired into `CustomRuleExecutor`; rejected rules
  emit a `custom-rule-rejected-by-sandbox` warning with the measured
  metrics in `details.sandboxMetrics`.

### Fixes

- `applyFixPatch(resource, patch)` executor for resolved `FixPatch`
  objects from the fix-suggestions catalog. Supports
  `add` / `replace` / `remove` on dotted paths with `[index]` array
  syntax, deep-clones the input, rejects unresolved `{{templates}}`,
  coerces JSON-shaped string values into objects/arrays/numbers/
  booleans/null.
- Fixed: fhirpath.js compiled-function `traceFn` was being passed in
  the wrong arg position (envVars instead of additionalOptions),
  causing `TRACE:[unmatched] []` lines to appear in CI output for
  any constraint that called `.trace()`. Moved to the third arg.

### Subpath exports (OSS extraction)

- `@records-fhir/validator/business-rules` — built-in business rule
  registry + element-path resolver, extracted from the server.
- `@records-fhir/validator/business-rules/rule-registry` — direct
  access to the rule registry for callers that wire their own
  catalogs.
- StructureDefinition → FHIRSchema converter prototype moved into
  the OSS validator surface.

### Boundary

- Dropped `node-fetch` runtime dep; uses platform `fetch`.
- New `FHIR_BUNDLED_PROFILES_PATH` env var so embedders can point at
  any local `~/.fhir/packages`-shaped directory tree.

### Distribution / day-1 OSS material

- `examples/` directory ships in the tarball (`standalone-validate.mjs`,
  `bulk-folder-validate.mjs`, `github-workflow.yml`, `README.md`).
- `CHANGELOG.md` and `CONTRIBUTING.md` ship in the tarball.
- `log-level` input on the composite GitHub Action with `warn`
  default — CI output for a typical run drops from ~47 to ~9 lines
  per file (100% signal).

### Internal — Records platform

- MII KDS 2026 advisor-rule starter set (`mii-kds.yaml` + TS mirror)
  plus a generic `AdvisorRuleSet` YAML loader.
- `getActiveAdvisorRules()` merges built-ins (canonical-URL sanity,
  MII KDS) with DB-managed customer rules deterministically.
- `mii-2026.records-lock.json` now contains transitive canonical
  pinning (was package-list only) when MII packages are resolvable
  on disk.
- `POST /api/validation/validateResource` MII-validator-compatible
  shim.
- Dataset Quality Reports gain per-resource-type issue rates
  (`resourceTypeIssueRates` field).
- HAPI Hybrid Bridge deployment guide (`docs/operations/`).

## [0.1.1] — Skipped

Bumped in `package.json` for the boundary cleanup landed in #104 but
never published to npm. Superseded by 0.1.2.

## [0.1.0] — Initial public release

The first public release of the open-source FHIR validation engine
extracted from the Records DataOps Control Plane.

### Conformance

- 100.0% (493/493) JSON resource parity against the HL7 Java validator's
  `OperationOutcome` baseline on the executable comparison set.
- Discovery-lane backlog executed comparisons at 100.0% (547/547) with
  0 skips and 0 failures. Former measurable failures and skipped fixtures are
  explicit Java-baseline compatibility fixtures for authenticated Infoway
  terminology, Java-CLI harness behavior, FML/NDJSON parser baselines,
  JSON5 and DSIG JSON harness cases, hidden Java outcomes, a known Java
  choice-type bug, a missing upstream Java outcome artifact, and the future
  SDC package lane.
- MII KDS 2026 scoped reference parity 241/241 measured resources against the
  official MII validator container (`mii-2026-reference` scope), with 12
  classified corpus/profile-drift skips.

### Validator engine

- Pure TypeScript validator — no JVM, no database, no Records server
  modules. Validates parsed FHIR JSON resources against
  StructureDefinitions, FHIRPath constraints, terminology bindings,
  references, slicing, extensions, metadata, and Bundle reachability.
- FHIR R4, R5, and R6 supported. STU3/DSTU is out of scope.
- Optional `setProfileSource()`, `setCustomRulesSource()`, and
  `setEngineLogger()` hooks for embedders that want to provide
  database-backed profile resolution, custom business rules, or routed
  logging. No-op defaults make standalone use a single import.
- Two-phase terminology: ValueSets from installed IG packages are
  expanded at install time into a flat code set with O(1) lookup,
  falling back to a configured terminology server.
- Canonical pinning with deterministic IG version selection,
  transitive dependency tree-shaking, and `.records-lock.json` lock
  file generation.
- Advisor rules engine for post-validation severity overrides and
  message rewrites. Built-in rule sets ship and self-scope:
  - Canonical-URL sanity (SNOMED `srt` typo, LOINC `https` typo,
    trailing-slash variants, etc.) — match by message substring.
  - MII KDS 2026 starter rules (NUM-CODEX secondary coding,
    Patientennummer assigner/system, Fall-Kontakt slicing,
    Medikation reference) — match by profile prefix.
- Recursive unknown-property walker descends into BackboneElement
  children and complex datatypes via lazy SD loading; expands choice
  types; skips `Resource` / `DomainResource` to keep noise out.
- `compliesWithProfile` derived-StructureDefinition compliance check
  with cardinality, missing-constraint, weakened-binding, slicing rule,
  and pattern/fixed conflict diagnostics.

### Distribution

- npm publish workflow at `validator-v*` GitHub release tags
  (`publish-validator.yml`) publishes `@records-fhir/validation-types` before
  `@records-fhir/validator`.
- Composite GitHub Action `medvertical/records-fhir-validator@v1`
  (`packages/validator/action.yml`) with inputs `paths`,
  `profile-url`, `fhir-version`, `fail-on`, `output-file`,
  `validator-version`, `log-level`. Outputs
  `issue-count` / `error-count` / `warning-count`.
- Action defaults to `log-level: warn` for clean CI annotations;
  raise to `info` or `debug` to see engine traces.

### Reproducibility

- `VALIDATION_ENGINE_VERSION` is env-gated: defaults to a stable cache
  key, derives `<pkg>+<gitsha>` when `ENGINE_VERSION_FROM_BUILD=true`
  for regulatory-mode runs.
- Evidence reports embed a SHA-256 `report_content_hash` over the
  payload via `EvidenceReportService.finalizeReportContent`.

### Internal fixes worth calling out

- fhirpath.js compiled-function `traceFn` was passed in the wrong
  argument position, causing `TRACE:[unmatched] []` lines to appear
  in CI output for any constraint that called `.trace()`. Moved to
  the third arg (additional options) where fhirpath actually reads
  it. Affects both the public package and the server-side mirror.

### Known limitations

- No CQL evaluator (the upstream `cql-evaluator` is not ported);
  `measure` module ceiling is around 60%.
- fhirpath.js R5-boundary functions (`lowBoundary`, `highBoundary`,
  `aggregate`) are not implemented upstream and cap a handful of
  R5/R6 tests.
- XML, Turtle, CDA, HL7 v2, NDJSON, FML, CDS Hooks, SHC, and DSIG
  are explicitly out of scope for this package and are not blended
  into the headline conformance score.

[Unreleased]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.5.0...HEAD
[0.5.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.4...validator-v0.5.0
[0.4.4]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.3...validator-v0.4.4
[0.4.3]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.2...validator-v0.4.3
[0.4.2]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.1...validator-v0.4.2
[0.4.1]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.4.0...validator-v0.4.1
[0.4.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.3.0...validator-v0.4.0
[0.3.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.2.0...validator-v0.3.0
[0.2.0]: https://github.com/medvertical/records-fhir-validator/compare/validator-v0.1.14...validator-v0.2.0
[0.1.0]: https://github.com/medvertical/records-fhir-validator/releases/tag/validator-v0.1.0
