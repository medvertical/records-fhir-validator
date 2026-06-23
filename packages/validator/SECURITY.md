# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue or PR for a suspected security
vulnerability.** Public exposure before a fix is shipped puts every
existing consumer at risk.

Instead, email **security@medvertical.com** with:

- A description of the vulnerability
- Steps to reproduce (a minimal FHIR resource + profile URL is ideal,
  no clinical payloads — Records' no-PHI invariant applies to bug
  reports too)
- The validator version (`@records-fhir/validator`'s `package.json`
  version, plus `VALIDATION_ENGINE_VERSION` if you set
  `ENGINE_VERSION_FROM_BUILD=true`)
- The FHIR version (R4 / R4B / R5 / R6) and the profile URL the
  resource was validated against
- Any relevant Records / commercial-product version, if applicable

We aim to acknowledge reports within **3 business days** and ship a
fix or mitigation within **14 days** for high-severity issues. The
disclosure timeline is coordinated with the reporter.

## Scope

In scope:

- The validator engine in `@records-fhir/validator` and the type
  package `@records-fhir/validation-types`.
- The composite GitHub Action `medvertical/records-fhir-validator@v0`.
- The optional bundled-profiles package.

Out of scope (file at the relevant project instead):

- The Records DataOps Control Plane web app (commercial; report via
  Medvertical support).
- Third-party FHIR profile/IG content shipped through `bundled-profiles`
  — those carry their upstream licenses and security policies.
- The HL7 FHIR Java validator and `tx.fhir.org` — report upstream.

## What we treat as in-scope vulnerabilities

- Anything that lets a crafted FHIR resource cause Records to
  exfiltrate data, escalate privilege, or execute arbitrary code.
- DoS via resource shape (e.g. an expression that bypasses the
  static FHIRPath sandbox limits and causes unbounded CPU). The
  sandbox is intentionally conservative — a working bypass is a
  bug.
- Data-leakage through evidence reports that customers expect to
  contain only redacted IDs (E-6 default-on, see the data-flow doc
  in `docs/operations/`).
- Supply-chain risks introduced by validator dependencies.

## What we explicitly do not treat as a security issue

- Validation false negatives or false positives that are equivalent
  to known HL7 Java validator behaviour. File those as conformance
  issues with both `OperationOutcome`s attached.
- Performance regressions without a denial-of-service shape.
- Issues requiring write access to the operator's filesystem
  (`setProfileSource`, `FHIR_BUNDLED_PROFILES_PATH`, etc.) — those
  are operator trust boundaries.

## Hardening notes for operators

- **Default-on resource ID redaction** in evidence-report API +
  CLI export (E-6). Pass `redactIds: false` only for internal
  workflows.
- **FHIRPath sandbox** rejects pathological customer-supplied
  Custom Rule expressions before fhirpath.js runs. Tune with
  `checkFhirpathSandbox(expr, { expressionLength, functionCallCount,
  nestingDepth })` if your invariants legitimately exceed defaults.
- **`RECORDS_API_TOKEN`** gates every `/api/*` endpoint. Health and
  observability endpoints are deliberately exempt.
- See `docs/operations/id-redaction-data-flow.md` (Records source
  repo) for an audit of every code path that can write a resource
  identifier.

## Coordinated disclosure

We follow standard coordinated-disclosure practice — we won't
publish details until the affected versions have a fix available. If
you intend to publish your own write-up, please coordinate the
timeline with us via the security email so existing consumers can
upgrade first.
