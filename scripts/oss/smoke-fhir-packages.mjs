import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function structureDefinition(type, elements) {
  return {
    resourceType: 'StructureDefinition',
    url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    version: '4.0.1',
    fhirVersion: '4.0.1',
    name: type,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type,
    snapshot: {
      element: [
        { id: type, path: type, min: 0, max: '*' },
        ...elements,
      ],
    },
  };
}

async function writePackageResource(packageDir, filename, resource) {
  await writeFile(join(packageDir, filename), `${JSON.stringify(resource, null, 2)}\n`, 'utf8');
}

export async function writeMinimalR4CorePackage(cacheRoot) {
  const packageDir = join(cacheRoot, 'hl7.fhir.r4.core#4.0.1', 'package');
  await mkdir(packageDir, { recursive: true });
  await writePackageResource(packageDir, 'package.json', {
    name: 'hl7.fhir.r4.core',
    version: '4.0.1',
    fhirVersions: ['4.0.1'],
  });
  await writePackageResource(packageDir, 'StructureDefinition-Patient.json', structureDefinition('Patient', [
    {
      id: 'Patient.gender',
      path: 'Patient.gender',
      min: 0,
      max: '1',
      type: [{ code: 'code' }],
      binding: {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
      },
    },
    {
      id: 'Patient.birthDate',
      path: 'Patient.birthDate',
      min: 0,
      max: '1',
      type: [{ code: 'date' }],
    },
  ]));
  await writePackageResource(packageDir, 'ValueSet-administrative-gender.json', {
    resourceType: 'ValueSet',
    url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
    version: '4.0.1',
    status: 'active',
    expansion: {
      contains: ['male', 'female', 'other', 'unknown'].map((code) => ({
        system: 'http://hl7.org/fhir/administrative-gender',
        code,
      })),
    },
  });
}

export async function writeMiiPresetSmokePackage(cacheRoot) {
  const id = 'de.medizininformatikinitiative.kerndatensatz.base';
  const directory = join(cacheRoot, `${id}#2026.0.0`, 'package');
  await mkdir(directory, { recursive: true });
  await writePackageResource(directory, 'package.json', { name: id, version: '2026.0.0', fhirVersions: ['4.0.1'] });
  // Minimal local profile to exercise the documented preset and package layout.
  await writePackageResource(directory, 'StructureDefinition-preset-smoke.json', {
    ...structureDefinition('Patient', []),
    url: 'https://example.test/StructureDefinition/Patient',
    version: '2026.0.0',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    derivation: 'constraint',
  });
}
