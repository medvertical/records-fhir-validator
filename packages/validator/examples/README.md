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
```

The GitHub workflow uses the composite Action and needs no extra setup:

```yaml
- uses: medvertical/records-fhir-validator@v0
  with:
    paths: 'examples/**/*.json'
```

## Profile-specific validation

By default each resource is validated against the base StructureDefinition
for its `resourceType`. To validate against a specific profile, pass the
canonical URL:

```js
const issues = await recordsValidator.validate(
  resource,
  'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/PatientIn',
  'R4',
);
```

Profiles must be resolvable — either through the bundled-profiles package,
through `setProfileSource(createFilesystemProfileSource(...))`, or through
a custom embedder hook.
