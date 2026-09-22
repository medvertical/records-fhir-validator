import { describe, expect, it } from 'vitest';
import {
  createEhds2026ValidationSettings,
  createMii2026ValidationSettings,
  FHIR_CORE_EXTENSION_PACKAGE_SET,
  FHIR_CORE_EXTENSION_PACKAGE_VERSIONS,
  FHIR_CORE_PACKAGE_SET,
  FHIR_CORE_PACKAGE_VERSIONS,
  FHIR_CORE_TERMINOLOGY_PACKAGE_SET,
  FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS
} from '../index';

describe('MII 2026 validation preset', () => {
  it('pins R4B core as a distinct maintenance-release package', () => {
    expect(FHIR_CORE_PACKAGE_SET)
      .toHaveLength(Object.keys(FHIR_CORE_PACKAGE_VERSIONS).length);
    expect(FHIR_CORE_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.r4b.core',
      version: '4.3.0',
    });
  });
  it('pins core terminology packages for deterministic local binding checks', () => {
    expect(FHIR_CORE_TERMINOLOGY_PACKAGE_SET)
      .toHaveLength(Object.keys(FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS).length);
    expect(FHIR_CORE_TERMINOLOGY_PACKAGE_SET).toContainEqual({
      id: 'hl7.terminology.r5',
      version: '7.1.0'
    });
  });

  it('pins core extension packages for deterministic local extension checks', () => {
    expect(FHIR_CORE_EXTENSION_PACKAGE_SET)
      .toHaveLength(Object.keys(FHIR_CORE_EXTENSION_PACKAGE_VERSIONS).length);
    expect(FHIR_CORE_EXTENSION_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.uv.extensions.r4',
      version: '5.3.0'
    });
    expect(FHIR_CORE_EXTENSION_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.uv.extensions.r5',
      version: '5.3.0'
    });
  });

  it('keeps the package pin set in sync with the version map', () => {
    expect(MII_2026_PACKAGE_SET).toHaveLength(Object.keys(MII_2026_PACKAGE_VERSIONS).length);
    expect(MII_2026_PACKAGE_SET).toContainEqual({
      id: 'de.medizininformatikinitiative.kerndatensatz.consent',
      version: '2026.0.1-rc-2'
    });
    expect(MII_2026_PACKAGE_SET).toContainEqual({
      id: 'de.einwilligungsmanagement',
      version: '2.0.3'
    });
    expect(MII_2026_PACKAGE_SET).toContainEqual({
      id: 'de.medizininformatikinitiative.kerndatensatz.pros',
      version: '2026.3.0'
    });
  });

  it('pins every MII 2026 package for deterministic auto-download', () => {
    const settings = createMii2026ValidationSettings();

    for (const { id, version } of MII_2026_PACKAGE_SET) {
      expect(settings.packageDownload?.pinnedVersions[id]).toBe(version);
      expect(settings.packageDownload?.approvedPackages).toContain(id);
    }
  });

  it('configures HAPI parity packages with explicit versions', () => {
    const settings = createMii2026ValidationSettings();

    expect(settings.hapiConfig?.igPackages).toContain(
      'de.medizininformatikinitiative.kerndatensatz.consent#2026.0.1-rc-2'
    );
    expect(settings.profileSources?.packageRegistry).toBe(true);
  });

  it('stamps explicit MII run metadata and Ontoserver guardrails', () => {
    const settings = createMii2026ValidationSettings();

    expect(settings.mii).toEqual({
      preset: 'mii-2026',
      terminologyMode: 'mii-local-blaze',
      maxOntoserverRequestsPerRun: 250,
      allowHighVolumeOntoserver: false
    });
  });

  it('allows callers to override selected settings without losing package pins', () => {
    const settings = createMii2026ValidationSettings({
      packageDownload: {
        autoDownload: false,
        pinnedVersions: {
          'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1-local'
        }
      },
      mii: {
        terminologyMode: 'mii-hybrid',
        packageLockHash: 'sha256-demo'
      }
    });

    expect(settings.packageDownload?.autoDownload).toBe(false);
    expect(settings.packageDownload?.pinnedVersions['de.basisprofil.r4']).toBe('1.5.4');
    expect(settings.packageDownload?.pinnedVersions['de.medizininformatikinitiative.kerndatensatz.laborbefund'])
      .toBe('2026.0.1-local');
    expect(settings.mii?.terminologyMode).toBe('mii-hybrid');
    expect(settings.mii?.packageLockHash).toBe('sha256-demo');
  });
});

describe('HL7 Europe EHDS 2026 package lane', () => {
  it('keeps the package pin set in sync with the version map', () => {
    expect(HL7_EU_EHDS_2026_PACKAGE_SET)
      .toHaveLength(Object.keys(HL7_EU_EHDS_2026_PACKAGE_VERSIONS).length);
    expect(HL7_EU_EHDS_2026_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.eu.laboratory',
      version: '2.0.0'
    });
    expect(HL7_EU_EHDS_2026_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.eu.eps',
      version: '1.0.0-ballot'
    });
    expect(HL7_EU_EHDS_2026_PACKAGE_SET).toContainEqual({
      id: 'hl7.fhir.uv.xver-r5.r4',
      version: '0.1.0'
    });
  });

  it('keeps the previous Xt-EHR pin as an explicit reference package', () => {
    expect(HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE).toEqual({
      id: 'hl7.fhir.eu.eps.r4',
      version: '1.0.0-xtehr'
    });
  });

  it('creates an independent EHDS preset without MII assignments', () => {
    const settings = createEhds2026ValidationSettings();

    for (const { id, version } of MII_2026_PACKAGE_SET) {
      expect(settings.packageDownload?.pinnedVersions[id]).toBeUndefined();
      expect(settings.hapiConfig?.igPackages).not.toContain(`${id}#${version}`);
    }
    for (const { id, version } of HL7_EU_EHDS_2026_PACKAGE_SET) {
      expect(settings.packageDownload?.pinnedVersions[id]).toBe(version);
      expect(settings.packageDownload?.approvedPackages).toContain(id);
      expect(settings.hapiConfig?.igPackages).toContain(`${id}#${version}`);
    }
    expect(settings.hapiConfig?.igPackages).not.toContain(
      'de.medizininformatikinitiative.kerndatensatz.consent#2026.0.1-rc-2'
    );
    expect(settings.mii).toBeUndefined();
  });
});
