# Changelog

All notable changes to `@records-fhir/validator` are documented in this
file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The companion `@records-fhir/validation-types` and
`@records-fhir/bundled-profiles` packages share this changelog when they
ship together; package-only changes are noted under each release.

## [Unreleased]

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
