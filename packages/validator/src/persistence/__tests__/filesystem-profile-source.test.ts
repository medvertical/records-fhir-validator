import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll } from 'vitest';
import { registerFilesystemProfileSourceContracts } from './filesystem-profile-source-contracts';

let packageRoot: string;
beforeAll(async () => {
  packageRoot = await mkdtemp(join(tmpdir(), 'records-synthetic-filesystem-profile-'));
  const packageDir = join(packageRoot, 'hl7.fhir.r4.core#4.0.1', 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1', fhirVersions: ['4.0.1'] }));
  await writeFile(join(packageDir, 'StructureDefinition-Patient.json'), JSON.stringify({
    resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/StructureDefinition/Patient',
    version: '4.0.1', fhirVersion: '4.0.1', name: 'SyntheticPatient', status: 'active',
    kind: 'resource', abstract: false, type: 'Patient',
    snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' }] },
  }));
});
afterAll(async () => { if (packageRoot) await rm(packageRoot, { recursive: true, force: true }); });
registerFilesystemProfileSourceContracts('Synthetic filesystem core lookup', () => [packageRoot]);
