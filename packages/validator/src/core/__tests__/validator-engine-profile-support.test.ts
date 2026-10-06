import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';

const CRD_DEVICE_REQUEST_URL = 'http://hl7.org/fhir/us/davinci-crd/StructureDefinition/profile-devicerequest';
const CRD_DEVICE_REQUEST_R4_ALIAS_URL = 'http://hl7.org/fhir/us/davinci-crd/R4/StructureDefinition/profile-devicerequest-r4';

function makeCrdDeviceRequestSd(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'profile-devicerequest',
    url: CRD_DEVICE_REQUEST_URL,
    version: '2.2.1',
    name: 'CRDDeviceRequestProfile',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'DeviceRequest',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/DeviceRequest',
    derivation: 'constraint',
    fhirVersion: '4.0.1',
    snapshot: {
      element: [{ id: 'DeviceRequest', path: 'DeviceRequest' }],
    },
  } as StructureDefinition;
}

describe('RecordsValidator profile support', () => {
  it('reports support for the published canonical and leaves its spelling alias unresolved', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'records-validator-profile-support-'));
    const validator = new RecordsValidator({
      packageCachePath: dir,
      bundledProfilesPath: null,
      autoDownload: false,
    });

    try {
      await validator.waitForInitialization();
      validator.getSdLoader().registerExternalProfile(makeCrdDeviceRequestSd(), 'R4');

      await expect(
        validator.isProfileSupported(CRD_DEVICE_REQUEST_R4_ALIAS_URL, 'R4'),
      ).resolves.toBe(false);
      await expect(validator.isProfileSupported(CRD_DEVICE_REQUEST_URL, 'R4')).resolves.toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
