import { describe, expect, it } from 'vitest';
import { PackageRegistryClient } from './package-registry-client';

describe('PackageRegistryClient package detection', () => {
  it('maps HL7 Europe EPS canonicals to the R4 package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'),
    ).resolves.toBe('hl7.fhir.eu.eps.r4');
  });

  it('maps HL7 Europe base canonicals to the EU base package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.eu/fhir/base/StructureDefinition/flag-patient-eu-core'),
    ).resolves.toBe('hl7.fhir.eu.base');
  });
});
