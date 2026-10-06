import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { recordProfilePackageProvenance } from '../../package/canonical-pin-provenance';
import { resolveValueSetPackageDirectories } from '../../validators/valueset-package-resource-access';
import { appendMandatedProfileValidationResults } from '../multi-aspect-mandated-profile';
import type { MultiAspectValidateResult } from '../multi-aspect-types';

vi.mock('../../validators/valueset-package-resource-access', async importOriginal => ({
  ...await importOriginal<typeof import('../../validators/valueset-package-resource-access')>(),
  resolveValueSetPackageDirectories: vi.fn(() => []),
}));

// CH Lab Report imposes EU Laboratory's result profile and was published
// against EU Laboratory 0.1.1, whose component value slicing is open; 2.0.0
// closes it.
const CH_BLOOD_GROUP = 'http://fhir.ch/ig/ch-lab-report/StructureDefinition/ch-lab-observation-blood-group';
const EU_RESULT = 'http://hl7.eu/fhir/laboratory/StructureDefinition/Observation-resultslab-eu-lab';
const IMPOSE_PROFILE = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-imposeProfile';

describe('profiles imposed by an IG profile', () => {
  let store: string | undefined;

  afterEach(async () => {
    clearCanonicalPinCaches();
    vi.mocked(resolveValueSetPackageDirectories).mockReturnValue([]);
    if (store) await rm(store, { recursive: true, force: true });
    store = undefined;
  });

  it('resolve in the release the imposing IG depends on', async () => {
    store = await mkdtemp(path.join(tmpdir(), 'imposed-pins-'));
    vi.mocked(resolveValueSetPackageDirectories).mockReturnValue([store]);
    await writePackage(store, 'ch.fhir.ig.ch-lab-report', '2.0.0', { 'hl7.fhir.eu.laboratory': '0.1.1' }, CH_BLOOD_GROUP);
    await writePackage(store, 'hl7.fhir.eu.laboratory', '0.1.1', {}, EU_RESULT);
    await writePackage(store, 'hl7.fhir.eu.laboratory', '2.0.0', {}, EU_RESULT);
    const sourceProfile = { url: CH_BLOOD_GROUP, version: '2.0.0', extension: [{ url: IMPOSE_PROFILE, valueCanonical: EU_RESULT }] };
    recordProfilePackageProvenance(sourceProfile, 'ch.fhir.ig.ch-lab-report#2.0.0');
    const validateOne = vi.fn(async () => ({ isValid: true, aspects: [] }) as MultiAspectValidateResult);

    await appendMandatedProfileValidationResults({ resourceType: 'Observation' }, CH_BLOOD_GROUP, 'R4', 0,
      validateOne, [], undefined, undefined, undefined,
      sourceProfile);

    expect(validateOne).toHaveBeenCalledWith(
      { resourceType: 'Observation' }, `${EU_RESULT}|0.1.1`, 'R4', 1, undefined, true, undefined,
    );
  });
});

async function writePackage(
  store: string,
  name: string,
  version: string,
  dependencies: Record<string, string>,
  profileUrl: string,
): Promise<void> {
  const packageDir = path.join(store, `${name}#${version}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name, version, fhirVersions: ['4.0.1'], dependencies,
  }));
  await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
    'index-version': 2,
    files: [{ filename: 'StructureDefinition-profile.json', resourceType: 'StructureDefinition', url: profileUrl, version }],
  }));
}
