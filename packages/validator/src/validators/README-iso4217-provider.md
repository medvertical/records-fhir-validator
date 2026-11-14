# ISO 4217 provider inventory

Configure an ISO 4217 CodeSystem or a terminology server with currency
coverage for standalone validation. The SDK does not include the source
currency inventory. The optional host capability supplies the integrity-pinned
inventory for an unversioned lookup after other local sources have been checked.

The host inventory establishes positive membership for listed identifiers.
Unknown identifiers, named terminology versions, filters and unavailable
display languages remain unverified. The inventory carries no evidence about
current circulation or historical validity intervals.

Selected host, registered, cached and package CodeSystems retain priority,
including incomplete definitions and failed lookups. Provider descriptors use
the existing immutable dependency capture and tenant/FHIR/pin scope checks.
Whole-system includes are evaluated through the full ValueSet compose with
exclusions and three-valued unknown results. A primitive code's system is
inferred only when the selected compose establishes exactly one system.

The currency ValueSet test fixture is copied unchanged from
`hl7.fhir.r4.core#4.0.1/package/ValueSet-currencies.json`; the ValueSet's 4.0.1
version does not turn the ISO provider into a 4.0.1 terminology edition.
No runtime network request or download is required.
