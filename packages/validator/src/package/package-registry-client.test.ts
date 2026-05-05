import { describe, expect, it } from 'vitest';
import { PackageRegistryClient } from './package-registry-client';

describe('PackageRegistryClient profile package detection', () => {
  const client = new PackageRegistryClient();

  it('keeps legacy MII core module mappings for pre-2026 canonicals', async () => {
    await expect(
      client.detectPackageForProfile(
        'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/MII-Patient'
      )
    ).resolves.toBe('de.medizininformatikinitiative.kerndatensatz.person');
  });

  it('maps MII 2026 core modules to the base package', async () => {
    await expect(
      client.detectPackageForProfile(
        'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/MII-Patient|2026.0.0'
      )
    ).resolves.toBe('de.medizininformatikinitiative.kerndatensatz.base');
  });

  it('detects MII 2026 extension module packages', async () => {
    await expect(
      client.detectPackageForProfile(
        'https://www.medizininformatik-initiative.de/fhir/core/modul-consent/StructureDefinition/MII-Consent|2026.0.1'
      )
    ).resolves.toBe('de.medizininformatikinitiative.kerndatensatz.consent');

    await expect(
      client.detectPackageForProfile(
        'https://www.medizininformatik-initiative.de/fhir/ext/modul-onkologie/StructureDefinition/MII-Onko|2026.0.3'
      )
    ).resolves.toBe('de.medizininformatikinitiative.kerndatensatz.onkologie');
  });
});
