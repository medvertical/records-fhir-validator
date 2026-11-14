# Examples

Three copy-pasteable starting points for using `@records-fhir/validator`.

| File | Use case |
|---|---|
| [`standalone-validate.mjs`](./standalone-validate.mjs) | Validate a single FHIR JSON file from a Node script. No DB, no JVM. |
| [`bulk-folder-validate.mjs`](./bulk-folder-validate.mjs) | Walk a folder, validate every `*.json`, exit non-zero on any error. |
| [`github-workflow.yml`](./github-workflow.yml) | Drop into `.github/workflows/` to gate every PR with the composite action. |

## Quick run

The standalone scripts have no dependencies beyond `@records-fhir/validator`
and Node 20+:

```sh
npm install @records-fhir/validator @records-fhir/validation-types
node standalone-validate.mjs path/to/patient.json
```

After installing the npm package, the same check is available through the CLI:

```sh
npx -p @records-fhir/validator records-fhir-validator path/to/patient.json
npx -p @records-fhir/validator records-fhir-validator ./fixtures --fail-on=warning --format=json
npx -p @records-fhir/validator records-fhir-validator ./fixtures --summary-only --output validation-report.json
```

The GitHub workflow pins both the composite Action and its npm validator:

```yaml
- uses: medvertical/records-fhir-validator@v0.10.2
  with:
    validator-version: '0.10.2'
    paths: 'examples/**/*.json'
```

Update both pins deliberately. An exact Action tag or commit SHA alone does not
pin the npm validator: omitting `validator-version` installs `latest`. These pins
select the two releases; transitive dependencies, FHIR packages and terminology
sources need separate controls for reproducible results.

## Profile-specific validation

By default each resource is validated against the base StructureDefinition
for its `resourceType`. To validate against a specific profile, pass the
canonical URL:

```js
const issues = await recordsValidator.validateRequest({
  resource,
  profileUrl:
    'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/PatientIn',
  fhirVersion: 'R4',
});
```

Profiles must be resolvable — either through the bundled-profiles package,
through `setProfileSource(createFilesystemProfileSource(...))`, or through
a custom embedder hook.
