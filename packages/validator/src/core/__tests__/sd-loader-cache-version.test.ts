import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { StructureDefinition } from '../structure-definition-types';
import { checkDatabaseCache } from '../sd-loader-db-cache';
import { warmUpProfilesFromDatabase } from '../sd-loader-profile-source-warmup';
import { setProfileSource } from '../../persistence';

const CORE_URL = 'http://hl7.org/fhir/StructureDefinition/MedicationRequest';
const PROFILE_URL = 'http://example.org/fhir/StructureDefinition/PatientProfile';
const US_CORE_COVERAGE_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-coverage';
const US_CORE_COVERAGE_ALIAS_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-Coverage';
const CRD_DEVICE_REQUEST_URL = 'http://hl7.org/fhir/us/davinci-crd/StructureDefinition/profile-devicerequest';
const CRD_DEVICE_REQUEST_R4_ALIAS_URL = 'http://hl7.org/fhir/us/davinci-crd/R4/StructureDefinition/profile-devicerequest-r4';
const CRD_DEVICE_REQUEST_LEGACY_ALIAS_URL = 'http://hl7.org/fhir/us/davinci-crd/StructureDefinition/profile-devicerequest-r4';
const MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-molgen/StructureDefinition/mii-pr-molgen-genomic-study-analysis';
const MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_ALIAS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-molgen/StructureDefinition/genomic-study-analysis|2026.0.4';
const MII_ICU_EXTRACORPOREAL_PROCEDURE_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-extrakorporales-verfahren';
const MII_ICU_ECT_EXTRACORPOREAL_PROCEDURE_ALIAS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-ect-extrakorporales-verfahren';
const MII_MTB_IN_SITU_HYBRIDIZATION_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-insituhybridization';
const MII_MTB_IN_SITU_HYBRIDIZATION_ALIAS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-biomarker-insituhybridization|2026.0.1';
const MII_MTB_MSI_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-msi';
const MII_MTB_MSI_ALIAS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-immunohistochemistry-msi';
const MII_MTB_SYSTEMIC_THERAPY_MEDICATION_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-systemtherapie-medication-statement';
const MII_MTB_SYSTEMIC_THERAPY_MEDICATION_ALIAS_URL = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/StructureDefinition/mii-pr-mtb-systemische-therapie-medication-statement';

function makeSd(id: string, fhirVersion: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id,
    url: CORE_URL,
    name: id,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'MedicationRequest',
    fhirVersion,
    snapshot: {
      element: [{ id: 'MedicationRequest', path: 'MedicationRequest' }],
    },
  } as unknown as StructureDefinition;
}

function makeVersionedProfileSd(version: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: `patient-profile-${version}`,
    url: PROFILE_URL,
    version,
    name: `PatientProfile${version.replace(/\W/g, '')}`,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    derivation: 'constraint',
    fhirVersion: '4.0.1',
    snapshot: {
      element: [{ id: 'Patient', path: 'Patient' }],
    },
  } as unknown as StructureDefinition;
}

function makeUsCoreCoverageSd(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'us-core-coverage',
    url: US_CORE_COVERAGE_URL,
    version: '8.0.0',
    name: 'USCoreCoverageProfile',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Coverage',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Coverage',
    derivation: 'constraint',
    fhirVersion: '4.0.1',
    snapshot: {
      element: [{ id: 'Coverage', path: 'Coverage' }],
    },
  } as unknown as StructureDefinition;
}

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
  } as unknown as StructureDefinition;
}

function makeProfileSd(
  id: string,
  url: string,
  version: string,
  type: string,
): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id,
    url,
    version,
    name: id.replace(/\W/g, ''),
    status: 'active',
    kind: 'resource',
    abstract: false,
    type,
    baseDefinition: `http://hl7.org/fhir/StructureDefinition/${type}`,
    derivation: 'constraint',
    fhirVersion: '4.0.1',
    snapshot: {
      element: [{ id: type, path: type }],
    },
  } as unknown as StructureDefinition;
}

async function writePackageProfile(
  source: string,
  packageName: string,
  fileName: string,
  sd: StructureDefinition,
): Promise<void> {
  const packageDir = join(source, packageName, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, fileName), JSON.stringify(sd));
}

async function makeLoader(
  options: { maxCacheEntries?: number; prewarmProfileSource?: boolean } = {},
): Promise<{ loader: StructureDefinitionLoader; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'records-sd-loader-'));
  await writePackageProfile(dir, 'hl7.fhir.r4.core#4.0.1',
    'StructureDefinition-MedicationRequest.json', makeSd('medicationrequest-r4', '4.0.1'));
  // These cache contracts need one R4 fallback, not the installed IG catalog.
  const loader = new StructureDefinitionLoader(dir, '', { autoDownload: false, ...options });
  await loader.waitForInitialization();
  return { loader, dir };
}

beforeEach(() => {
  setProfileSource({});
});

afterEach(() => {
  setProfileSource({});
});

describe('StructureDefinitionLoader versioned cache', () => {
  it('can skip eager ProfileSource warmup while preserving on-demand loading', async () => {
    const loadAllForWarmup = vi.fn().mockResolvedValue(new Map());
    const profile = makeVersionedProfileSd('1.1.0');
    const findByUrl = vi.fn().mockResolvedValue(profile);
    setProfileSource({ loadAllForWarmup, findByUrl });

    const { loader, dir } = await makeLoader({ prewarmProfileSource: false });
    try {
      expect(loadAllForWarmup).not.toHaveBeenCalled();
      await expect(loader.loadProfile(PROFILE_URL, 'R4')).resolves.toBe(profile);
      expect(findByUrl).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the loader cache path for the default package downloader', async () => {
    const { loader, dir } = await makeLoader();
    try {
      expect((loader as any).runtime.packageDownloader.cachePath).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes versioned HL7 core StructureDefinition aliases for the matching FHIR family', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const r5 = makeSd('medicationrequest-r5', '5.0.0');
      loader.registerExternalProfile(r5, 'R5');

      await expect(
        loader.loadProfile('http://hl7.org/fhir/5.0/StructureDefinition/MedicationRequest', 'R5')
      ).resolves.toBe(r5);

      const batch = await loader.loadProfilesBatch([
        'http://hl7.org/fhir/5.0/StructureDefinition/MedicationRequest',
      ], 'R5');
      expect(batch.get('http://hl7.org/fhir/5.0/StructureDefinition/MedicationRequest')).toBe(r5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not normalize versioned HL7 core aliases across FHIR families', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const r4 = makeSd('medicationrequest-r4', '4.0.1');
      loader.registerExternalProfile(r4, 'R4');

      await expect(
        loader.loadProfile('http://hl7.org/fhir/5.0/StructureDefinition/MedicationRequest', 'R4')
      ).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves known US Core case aliases to package canonical casing', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const sd = makeUsCoreCoverageSd();
      loader.registerExternalProfile(sd, 'R4');

      await expect(
        loader.loadProfile(US_CORE_COVERAGE_ALIAS_URL, 'R4')
      ).resolves.toBe(sd);

      const batch = await loader.loadProfilesBatch([US_CORE_COVERAGE_ALIAS_URL], 'R4');
      expect(batch.get(US_CORE_COVERAGE_ALIAS_URL)).toBe(sd);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves known Da Vinci CRD DeviceRequest legacy aliases to the published canonical', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const sd = makeCrdDeviceRequestSd();
      loader.registerExternalProfile(sd, 'R4');

      await expect(
        loader.loadProfile(CRD_DEVICE_REQUEST_R4_ALIAS_URL, 'R4')
      ).resolves.toBe(sd);
      await expect(
        loader.loadProfile(CRD_DEVICE_REQUEST_LEGACY_ALIAS_URL, 'R4')
      ).resolves.toBe(sd);

      const batch = await loader.loadProfilesBatch([CRD_DEVICE_REQUEST_R4_ALIAS_URL], 'R4');
      expect(batch.get(CRD_DEVICE_REQUEST_R4_ALIAS_URL)).toBe(sd);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves known MII package canonical aliases to their published package canonicals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'records-sd-loader-'));
    try {
      await writePackageProfile(
        dir,
        'de.medizininformatikinitiative.kerndatensatz.molgen#2026.0.4',
        'StructureDefinition-mii-pr-molgen-genomic-study-analysis.json',
        makeProfileSd(
          'mii-pr-molgen-genomic-study-analysis',
          MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_URL,
          '2026.0.4',
          'Procedure',
        ),
      );
      await writePackageProfile(
        dir,
        'de.medizininformatikinitiative.kerndatensatz.icu#2026.0.2',
        'StructureDefinition-mii-pr-icu-ect-extrakorporales-verfahren.json',
        makeProfileSd(
          'mii-pr-icu-ect-extrakorporales-verfahren',
          MII_ICU_EXTRACORPOREAL_PROCEDURE_URL,
          '2026.0.2',
          'Procedure',
        ),
      );
      await writePackageProfile(
        dir,
        'de.medizininformatikinitiative.kerndatensatz.mtb#2026.0.1',
        'StructureDefinition-mii-pr-mtb-insituhybridization.json',
        makeProfileSd(
          'mii-pr-mtb-insituhybridization',
          MII_MTB_IN_SITU_HYBRIDIZATION_URL,
          '2026.0.1',
          'Observation',
        ),
      );
      await writePackageProfile(
        dir,
        'de.medizininformatikinitiative.kerndatensatz.mtb#2026.0.1',
        'StructureDefinition-mii-pr-mtb-msi.json',
        makeProfileSd(
          'mii-pr-mtb-msi',
          MII_MTB_MSI_URL,
          '2026.0.1',
          'Observation',
        ),
      );
      await writePackageProfile(
        dir,
        'de.medizininformatikinitiative.kerndatensatz.mtb#2026.0.1',
        'StructureDefinition-mii-pr-mtb-systemtherapie-medication-statement.json',
        makeProfileSd(
          'mii-pr-mtb-systemtherapie-medication-statement',
          MII_MTB_SYSTEMIC_THERAPY_MEDICATION_URL,
          '2026.0.1',
          'MedicationStatement',
        ),
      );

      const loader = new StructureDefinitionLoader(dir, '', { autoDownload: false });
      await loader.waitForInitialization();

      await expect(
        loader.loadProfile(MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_ALIAS_URL, 'R4')
      ).resolves.toMatchObject({
        url: MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_URL,
        version: '2026.0.4',
      });
      await expect(
        loader.loadProfile(MII_ICU_ECT_EXTRACORPOREAL_PROCEDURE_ALIAS_URL, 'R4')
      ).resolves.toMatchObject({
        url: MII_ICU_EXTRACORPOREAL_PROCEDURE_URL,
        version: '2026.0.2',
      });
      await expect(
        loader.loadProfile(MII_MTB_IN_SITU_HYBRIDIZATION_ALIAS_URL, 'R4')
      ).resolves.toMatchObject({
        url: MII_MTB_IN_SITU_HYBRIDIZATION_URL,
        version: '2026.0.1',
      });
      await expect(
        loader.loadProfile(MII_MTB_MSI_ALIAS_URL, 'R4')
      ).resolves.toMatchObject({
        url: MII_MTB_MSI_URL,
        version: '2026.0.1',
      });
      await expect(
        loader.loadProfile(MII_MTB_SYSTEMIC_THERAPY_MEDICATION_ALIAS_URL, 'R4')
      ).resolves.toMatchObject({
        url: MII_MTB_SYSTEMIC_THERAPY_MEDICATION_URL,
        version: '2026.0.1',
      });

      const batch = await loader.loadProfilesBatch([
        MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_ALIAS_URL,
        MII_ICU_ECT_EXTRACORPOREAL_PROCEDURE_ALIAS_URL,
        MII_MTB_IN_SITU_HYBRIDIZATION_ALIAS_URL,
        MII_MTB_MSI_ALIAS_URL,
        MII_MTB_SYSTEMIC_THERAPY_MEDICATION_ALIAS_URL,
      ], 'R4');
      expect(batch.get(MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_ALIAS_URL)?.url)
        .toBe(MII_MOLGEN_GENOMIC_STUDY_ANALYSIS_URL);
      expect(batch.get(MII_ICU_ECT_EXTRACORPOREAL_PROCEDURE_ALIAS_URL)?.url)
        .toBe(MII_ICU_EXTRACORPOREAL_PROCEDURE_URL);
      expect(batch.get(MII_MTB_IN_SITU_HYBRIDIZATION_ALIAS_URL)?.url)
        .toBe(MII_MTB_IN_SITU_HYBRIDIZATION_URL);
      expect(batch.get(MII_MTB_MSI_ALIAS_URL)?.url)
        .toBe(MII_MTB_MSI_URL);
      expect(batch.get(MII_MTB_SYSTEMIC_THERAPY_MEDICATION_ALIAS_URL)?.url)
        .toBe(MII_MTB_SYSTEMIC_THERAPY_MEDICATION_URL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not return bare or R5 cached profiles for R4 batch loading', async () => {
    const { loader, dir } = await makeLoader();
    try {
      const r4 = makeSd('medicationrequest-r4', '4.0.1');
      const r5 = makeSd('medicationrequest-r5', '5.0.0');

      (loader as any).runtime.cache.set(CORE_URL, r5);
      (loader as any).runtime.cache.set(`${CORE_URL}:R5`, r5);

      const r4Result = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect((r4Result.get(CORE_URL) as any)?.fhirVersion).toMatch(/^4\./);

      (loader as any).runtime.cache.set(`${CORE_URL}:R4`, r4);
      const r4Hit = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect(r4Hit.get(CORE_URL)?.id).toBe('medicationrequest-r4');

      const r5Hit = await loader.loadProfilesBatch([CORE_URL], 'R5');
      expect(r5Hit.get(CORE_URL)?.id).toBe('medicationrequest-r5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stores ProfileSource warmup entries under their FHIR version family', async () => {
    const r5 = makeSd('medicationrequest-r5', '5.0.0');
    setProfileSource({
      async loadAllForWarmup() {
        return new Map([
          [CORE_URL, { canonicalUrl: CORE_URL, profile: r5 }],
        ]);
      },
    });

    const { loader, dir } = await makeLoader();
    try {
      const r4Result = await loader.loadProfilesBatch([CORE_URL], 'R4');
      expect((r4Result.get(CORE_URL) as any)?.fhirVersion).toMatch(/^4\./);

      const r5Hit = await loader.loadProfilesBatch([CORE_URL], 'R5');
      expect(r5Hit.get(CORE_URL)?.id).toBe('medicationrequest-r5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['registerExternalProfile', (loader: StructureDefinitionLoader, profile: StructureDefinition) => {
      loader.registerExternalProfile(profile, 'R4');
    }],
    ['cacheProfile', (loader: StructureDefinitionLoader, profile: StructureDefinition) => {
      loader.cacheProfile(profile.url, profile, 'R4');
    }],
  ] as const)('preserves profiles added through %s when pruning reloadable entries', async (_method, addProfile) => {
    const { loader, dir } = await makeLoader({ maxCacheEntries: 1 });
    try {
      const externalProfile = makeVersionedProfileSd('1.1.0');
      const reloadableProfile = makeUsCoreCoverageSd();
      addProfile(loader, externalProfile);
      (loader as any).runtime.cache.set(`${reloadableProfile.url}:R4`, reloadableProfile);

      await expect(loader.loadProfile(externalProfile.url, 'R4'))
        .resolves.toMatchObject({ url: externalProfile.url });
      await expect(loader.loadProfile(externalProfile.url, 'R4'))
        .resolves.toMatchObject({ url: externalProfile.url });

      expect((loader as any).runtime.cache.has(`${externalProfile.url}:R4`)).toBe(true);
      expect((loader as any).runtime.cache.has(`${reloadableProfile.url}:R4`)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('checkDatabaseCache', () => {
  it('rejects ProfileSource entries from the wrong FHIR version', async () => {
    const r5 = makeSd('medicationrequest-r5', '5.0.0');
    setProfileSource({
      async findByUrl() {
        return r5;
      },
    });

    await expect(checkDatabaseCache(CORE_URL, 'R4')).resolves.toBeNull();
    await expect(checkDatabaseCache(CORE_URL, 'R5')).resolves.toBe(r5);
  });

  it('rechecks a wrong explicit canonical version on the next source lookup', async () => {
    const wrongVersion = makeVersionedProfileSd('1.3.1');
    const exactVersion = makeVersionedProfileSd('1.1.0');
    let calls = 0;
    setProfileSource({
      async findByUrl() {
        return calls++ === 0 ? wrongVersion : exactVersion;
      },
    });

    const requested = `${PROFILE_URL}|1.1.0`;
    await expect(checkDatabaseCache(requested, 'R4')).resolves.toBeNull();
    await expect(checkDatabaseCache(requested, 'R4')).resolves.toBe(exactVersion);
  });

  it('accepts ProfileSource entries for the requested explicit canonical version', async () => {
    const exactVersion = makeVersionedProfileSd('1.1.0');
    setProfileSource({
      async findByUrl() {
        return exactVersion;
      },
    });

    await expect(checkDatabaseCache(`${PROFILE_URL}|1.1.0`, 'R4')).resolves.toBe(exactVersion);
  });

  it('rejects a ProfileSource entry for a different canonical URL', async () => {
    const wrongProfile = {
      ...makeVersionedProfileSd('1.1.0'),
      url: 'http://example.org/fhir/StructureDefinition/OtherProfile',
    };
    setProfileSource({ findByUrl: async () => wrongProfile });

    await expect(checkDatabaseCache(`${PROFILE_URL}|1.1.0`, 'R4')).resolves.toBeNull();
  });
});

describe('warmUpProfilesFromDatabase', () => {
  it('stores versioned ProfileSource warmup entries under exact loader keys', async () => {
    const profile = makeVersionedProfileSd('1.1.0');
    setProfileSource({
      async loadAllForWarmup() {
        return new Map([
          [`${PROFILE_URL}|1.1.0`, {
            canonicalUrl: PROFILE_URL,
            version: '1.1.0',
            profile,
          }],
        ]);
      },
    });

    const cache = new Map<string, StructureDefinition>();
    const availableProfiles = new Set<string>();

    await warmUpProfilesFromDatabase({ cache, availableProfiles });

    expect(cache.get(`${PROFILE_URL}:R4`)).toMatchObject({ version: '1.1.0' });
    expect(cache.get(`${PROFILE_URL}|1.1.0:R4`)).toMatchObject({ version: '1.1.0' });
    expect(availableProfiles.has(PROFILE_URL)).toBe(true);
    expect(availableProfiles.has(`${PROFILE_URL}|1.1.0`)).toBe(true);
  });

  it('does not create a versioned warmup alias for unknown versions', async () => {
    const profile = makeVersionedProfileSd('1.1.0');
    setProfileSource({
      async loadAllForWarmup() {
        return new Map([
          [PROFILE_URL, {
            canonicalUrl: PROFILE_URL,
            version: 'unknown',
            profile,
          }],
        ]);
      },
    });

    const cache = new Map<string, StructureDefinition>();
    const availableProfiles = new Set<string>();

    await warmUpProfilesFromDatabase({ cache, availableProfiles });

    expect(cache.has(`${PROFILE_URL}|unknown:R4`)).toBe(false);
    expect(availableProfiles.has(`${PROFILE_URL}|unknown`)).toBe(false);
  });

  it('does not warm a profile whose content belongs to another canonical', async () => {
    const wrongProfile = {
      ...makeVersionedProfileSd('1.1.0'),
      url: 'http://example.org/fhir/StructureDefinition/OtherProfile',
    };
    setProfileSource({
      async loadAllForWarmup() {
        return new Map([
          [PROFILE_URL, {
            canonicalUrl: PROFILE_URL,
            version: '1.1.0',
            profile: wrongProfile,
          }],
        ]);
      },
    });
    const cache = new Map<string, StructureDefinition>();
    const availableProfiles = new Set<string>();

    await warmUpProfilesFromDatabase({ cache, availableProfiles });

    expect(cache.size).toBe(0);
    expect(availableProfiles.size).toBe(0);
  });
});
