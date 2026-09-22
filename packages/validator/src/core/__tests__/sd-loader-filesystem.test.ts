import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRelevantPackage, loadFromLocalCache } from '../sd-loader-filesystem';
import { PackageProfileIndexCache } from '../sd-loader-package-profile-index';

describe('sd-loader-filesystem', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('binds core selection to the requested public release when the lock pins R4 and R4B', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-r4b-'));
    tempDirs.push(source);
    const profileUrl = 'http://hl7.org/fhir/StructureDefinition/Patient';
    await writeStructureDefinition(
      source,
      'hl7.fhir.r4.core#4.0.1',
      'StructureDefinition-Patient.json',
      profileUrl,
      '4.0.1',
      'Patient',
    );
    await writeStructureDefinition(
      source,
      'hl7.fhir.r4b.core#4.3.0',
      'StructureDefinition-Patient.json',
      profileUrl,
      '4.3.0',
      'Patient',
    );

    const pins = {
      'hl7.fhir.r4.core': '4.0.1',
      'hl7.fhir.r4b.core': '4.3.0',
    };
    const indexCache = new PackageProfileIndexCache();
    await expect(loadFromLocalCache(
      profileUrl,
      [source],
      'R4',
      pins,
      indexCache,
      'hl7.fhir.r4b.core',
    )).resolves.toMatchObject({ version: '4.3.0' });
    await expect(loadFromLocalCache(
      profileUrl,
      [source],
      'R4',
      pins,
      indexCache,
      'hl7.fhir.r4.core',
    )).resolves.toMatchObject({ version: '4.0.1' });
    expect(isRelevantPackage(
      'hl7.fhir.r4.core#4.0.1', profileUrl, 'R4', 'hl7.fhir.r4b.core',
    )).toBe(false);
    expect(isRelevantPackage(
      'hl7.fhir.r4b.core#4.3.0', profileUrl, 'R4', 'hl7.fhir.r4.core',
    )).toBe(false);
  });

  it('honors package version pins when the same canonical exists in multiple package versions', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-source-'));
    tempDirs.push(source);
    const profileUrl = 'http://example.org/fhir/StructureDefinition/pinned-profile';
    await writeStructureDefinition(
      source,
      'example.fhir#1.0.0',
      'StructureDefinition-pinned-v1.json',
      profileUrl,
      '1.0.0',
    );
    await writeStructureDefinition(
      source,
      'example.fhir#2.0.0',
      'StructureDefinition-pinned-v2.json',
      profileUrl,
      '2.0.0',
    );

    await expect(loadFromLocalCache(
      profileUrl,
      [source],
      'R4',
      { 'example.fhir': '1.0.0' },
    )).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('does not fall back to an unpinned package version when the pin is absent locally', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-source-'));
    tempDirs.push(source);
    const profileUrl = 'http://example.org/fhir/StructureDefinition/pinned-profile';
    await writeStructureDefinition(
      source,
      'example.fhir#2.0.0',
      'StructureDefinition-pinned-v2.json',
      profileUrl,
      '2.0.0',
    );

    await expect(loadFromLocalCache(
      profileUrl,
      [source],
      'R4',
      { 'example.fhir': '1.0.0' },
    )).resolves.toBeNull();
  });

  it('uses a package index to skip files that cannot match the requested canonical', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-index-'));
    tempDirs.push(source);
    const packageDir = path.join(source, 'example.fhir#1.0.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, '.index.json'), JSON.stringify({
      files: [{
        resourceType: 'StructureDefinition',
        url: 'http://example.org/fhir/StructureDefinition/indexed-profile',
      }],
    }));
    await writeFile(
      path.join(packageDir, 'StructureDefinition-unindexed-profile.json'),
      '{ invalid json that must not be read',
    );

    await expect(loadFromLocalCache(
      'http://example.org/fhir/StructureDefinition/missing-profile',
      [source],
      'R4',
    )).resolves.toBeNull();
  });

  async function writeProfile(source: string, packageName: string, version: string): Promise<void> {
    const packageDir = path.join(source, packageName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-qicore-procedure.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure',
        version,
        fhirVersion: '4.0.1',
        type: 'Procedure',
      }),
    );
  }

  async function writeStructureDefinition(
    source: string,
    packageName: string,
    fileName: string,
    url: string,
    version: string,
    type = 'PlanDefinition',
  ): Promise<void> {
    const packageDir = path.join(source, packageName, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, fileName),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url,
        version,
        fhirVersion: '4.0.1',
        type,
      }),
    );
  }

  it('prefers the released profile over a pre-release of the same canonical', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    await writeProfile(source, 'hl7.fhir.us.qicore#8.0.0-ballot', '8.0.0-ballot');
    await writeProfile(source, 'hl7.fhir.us.qicore#7.0.0', '7.0.0');

    const sd = await loadFromLocalCache(
      'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure',
      [source],
      'R4',
    );

    // The ballot sorts above 7.0.0 by version, and is still the draft of a
    // canonical that has a published answer.
    expect(sd?.version).toBe('7.0.0');
  });

  // Refusing the ballot here reaches no safer profile — there is none. It
  // validates against the base resource and reports the profile as
  // unresolvable while it sits in the package the reader installed.
  it('falls back to the pre-release when no release of the canonical is installed', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    await writeProfile(source, 'hl7.fhir.us.qicore#8.0.0-ballot', '8.0.0-ballot');

    const sd = await loadFromLocalCache(
      'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure',
      [source],
      'R4',
    );

    expect(sd?.version).toBe('8.0.0-ballot');
  });

  it('still resolves explicitly version-pinned pre-release canonicals', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    await writeProfile(source, 'hl7.fhir.us.qicore#8.0.0-ballot', '8.0.0-ballot');

    const sd = await loadFromLocalCache(
      'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure|8.0.0-ballot',
      [source],
      'R4',
    );

    expect(sd?.version).toBe('8.0.0-ballot');
  });

  it('resolves the explicitly selected R6 ballot core for unversioned base canonicals', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-r6-'));
    tempDirs.push(source);
    const packageDir = path.join(source, 'hl7.fhir.r6.core#6.0.0-ballot4', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-Patient.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/Patient',
        version: '6.0.0-ballot4',
        fhirVersion: '6.0.0-ballot4',
        type: 'Patient',
      }),
    );

    await expect(loadFromLocalCache(
      'http://hl7.org/fhir/StructureDefinition/Patient',
      [source],
      'R6',
    )).resolves.toMatchObject({ version: '6.0.0-ballot4' });
    await expect(loadFromLocalCache(
      'http://hl7.org/fhir/StructureDefinition/Patient',
      [source],
      'R4',
    )).resolves.toBeNull();
  });

  it('resolves unversioned canonicals to the latest stable local StructureDefinition version', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const profileUrl = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-coverage';
    await writeStructureDefinition(
      source,
      'hl7.fhir.us.core#6.1.0',
      'StructureDefinition-us-core-coverage.json',
      profileUrl,
      '6.1.0',
      'Coverage',
    );
    await writeStructureDefinition(
      source,
      'hl7.fhir.us.core#9.0.0',
      'StructureDefinition-us-core-coverage.json',
      profileUrl,
      '9.0.0',
      'Coverage',
    );
    await writeStructureDefinition(
      source,
      'hl7.fhir.us.core#10.0.0-ballot',
      'StructureDefinition-us-core-coverage.json',
      profileUrl,
      '10.0.0-ballot',
      'Coverage',
    );

    const sd = await loadFromLocalCache(profileUrl, [source], 'R4');
    expect(sd?.version).toBe('9.0.0');
  });

  it('does not resolve an explicitly versioned canonical to a different cached version', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    await writeProfile(source, 'hl7.fhir.us.qicore#8.0.0', '8.0.0');

    await expect(
      loadFromLocalCache(
        'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure|7.0.0',
        [source],
        'R4',
      ),
    ).resolves.toBeNull();
  });

  it('resolves short canonical versions to equivalent published StructureDefinition versions', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const profileUrl = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire';
    await writeStructureDefinition(
      source,
      'hl7.fhir.uv.sdc#2.7.0',
      'StructureDefinition-sdc-questionnaire.json',
      profileUrl,
      '2.7.0',
      'Questionnaire',
    );

    const sd = await loadFromLocalCache(`${profileUrl}|2.7`, [source], 'R4');
    expect(sd?.version).toBe('2.7.0');
  });

  it('resolves unversioned EPS canonicals to the only installed pre-release package', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const packageDir = path.join(source, 'hl7.fhir.eu.eps.r4#1.0.0-xtehr', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-bundle-eu-eps.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
        version: '1.0.0-xtehr',
        fhirVersion: '4.0.1',
        type: 'Bundle',
      }),
    );

    const sd = await loadFromLocalCache(
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      [source],
      'R4',
    );

    expect(sd?.version).toBe('1.0.0-xtehr');
  });

  it('resolves HL7 core extension StructureDefinitions from the matching extension package', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const packageDir = path.join(source, 'hl7.fhir.uv.extensions.r4#5.3.0', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-itemWeight.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/itemWeight',
        version: '5.3.0',
        fhirVersion: '4.0.1',
        kind: 'complex-type',
        type: 'Extension',
      }),
    );
    await writeFile(
      path.join(packageDir, 'StructureDefinition-preferredTerminologyServer.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/preferredTerminologyServer',
        version: '5.3.0',
        fhirVersion: '4.0.1',
        kind: 'complex-type',
        type: 'Extension',
      }),
    );

    expect(isRelevantPackage(
      'hl7.fhir.uv.extensions.r4#5.3.0',
      'http://hl7.org/fhir/StructureDefinition/itemWeight',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'hl7.fhir.uv.extensions.r5#5.3.0',
      'http://hl7.org/fhir/StructureDefinition/itemWeight',
      'R4',
    )).toBe(false);

    await expect(loadFromLocalCache(
      'http://hl7.org/fhir/StructureDefinition/itemWeight',
      [source],
      'R4',
    )).resolves.toMatchObject({
      url: 'http://hl7.org/fhir/StructureDefinition/itemWeight',
      type: 'Extension',
    });

    await expect(loadFromLocalCache(
      'http://hl7.org/fhir/StructureDefinition/preferredTerminologyServer',
      [source],
      'R4',
    )).resolves.toMatchObject({
      url: 'http://hl7.org/fhir/StructureDefinition/preferredTerminologyServer',
      type: 'Extension',
    });
  });

  it('routes HL7 UV canonicals only through their owning IG package', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const vulcanUrl = 'http://hl7.org/fhir/uv/vulcan-schedule/StructureDefinition/StudyVisitSoa';

    await writeStructureDefinition(
      source,
      'hl7.fhir.uv.vulcan-schedule.r4#1.0.0-ballot',
      'StructureDefinition-StudyVisitSoa.json',
      vulcanUrl,
      '1.0.0-ballot',
    );
    await writeStructureDefinition(
      source,
      'hl7.fhir.uv.ips#2.0.0',
      'StructureDefinition-StudyVisitSoa.json',
      vulcanUrl,
      '2.0.0',
    );

    expect(isRelevantPackage(
      'hl7.fhir.uv.vulcan-schedule.r4#1.0.0-ballot',
      vulcanUrl,
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'hl7.fhir.uv.ips#2.0.0',
      vulcanUrl,
      'R4',
    )).toBe(false);

    // The ips package ships a file with the same canonical at a higher
    // version. Routing, not the version, decides which one answers.
    await expect(loadFromLocalCache(vulcanUrl, [source], 'R4'))
      .resolves.toMatchObject({ url: vulcanUrl, version: '1.0.0-ballot' });
  });

  it('does not resolve local profiles from a different FHIR version family', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const profileUrl = 'http://hl7.org/fhir/uv/vulcan-schedule/StructureDefinition/SOA-PlanDefinition';
    await writeStructureDefinition(
      source,
      'hl7.fhir.uv.vulcan-schedule#1.0.0',
      'StructureDefinition-SOA-PlanDefinition.json',
      profileUrl,
      '1.0.0',
    );

    await expect(loadFromLocalCache(profileUrl, [source], 'R5')).resolves.toBeNull();
    await expect(loadFromLocalCache(profileUrl, [source], 'R4')).resolves.toMatchObject({
      url: profileUrl,
      fhirVersion: '4.0.1',
    });
  });

  it('does not misroute MII polygener risiko profiles through the ISiK package filter', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const packageDir = path.join(
      source,
      'de.medizininformatikinitiative.kerndatensatz.molgen#2026.0.4',
      'package',
    );
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-mii-pr-molgen-polygener-risiko-score.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-molgen/StructureDefinition/polygener-risiko-score',
        version: '2026.0.4',
        fhirVersion: '4.0.1',
        type: 'RiskAssessment',
      }),
    );

    const profileUrl =
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-molgen/StructureDefinition/polygener-risiko-score|2026.0.4';

    expect(isRelevantPackage(
      'de.medizininformatikinitiative.kerndatensatz.molgen#2026.0.4',
      profileUrl,
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'de.gematik.isik-basismodul#4.0.3',
      profileUrl,
      'R4',
    )).toBe(false);

    const sd = await loadFromLocalCache(profileUrl, [source], 'R4');
    expect(sd?.type).toBe('RiskAssessment');
  });

  it('restricts European and IHE Pharmacy canonicals to their owning packages', () => {
    expect(isRelevantPackage(
      'hl7.fhir.eu.eps#1.0.0-xtehr',
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'de.medizininformatikinitiative.kerndatensatz.medikation#2026.0.1',
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    )).toBe(false);

    expect(isRelevantPackage(
      'hl7.fhir.eu.base#current',
      'http://hl7.eu/fhir/base/StructureDefinition/medication-eu-core',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'hl7.fhir.us.qicore#8.0.0-ballot',
      'http://hl7.eu/fhir/base/StructureDefinition/medication-eu-core',
      'R4',
    )).toBe(false);

    expect(isRelevantPackage(
      'ihe.pharm.mpd.r4#1.0.0-comment-2',
      'https://profiles.ihe.net/PHARM/MPD/StructureDefinition/ihe-ext-medication-productname',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'hl7.fhir.uv.ips#2.0.0',
      'https://profiles.ihe.net/PHARM/MPD/StructureDefinition/ihe-ext-medication-productname',
      'R4',
    )).toBe(false);
  });

  it('restricts KBV EAU and FOR canonicals to their owning packages', () => {
    expect(isRelevantPackage(
      'kbv.ita.eau#1.1.0',
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Bundle|1.1.0',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'kbv.basis#1.1.0',
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Bundle|1.1.0',
      'R4',
    )).toBe(false);

    expect(isRelevantPackage(
      'kbv.ita.for#1.1.0',
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Practitioner|1.1.0',
      'R4',
    )).toBe(true);
    expect(isRelevantPackage(
      'kbv.ita.eau#1.1.0',
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Practitioner|1.1.0',
      'R4',
    )).toBe(false);

    expect(isRelevantPackage(
      'kbv.ita.eau#1.1.0',
      'https://fhir.kbv.de/StructureDefinition/KBV_EX_EAU_7_weeks',
      'R4',
    )).toBe(true);
  });

  it('invalidates a local package index when profiles are added or removed', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    const packageDir = path.join(source, 'kbv.ita.eau#1.1.0', 'package');
    await mkdir(packageDir, { recursive: true });
    const indexCache = new PackageProfileIndexCache();
    await writeFile(
      path.join(packageDir, 'StructureDefinition-KBV_PR_EAU_Bundle.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Bundle',
        version: '1.1.0',
        fhirVersion: '4.0.1',
        type: 'Bundle',
      }),
    );
    await expect(loadFromLocalCache(
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Bundle|1.1.0',
      [source],
      'R4',
      {},
      indexCache,
    )).resolves.toMatchObject({ type: 'Bundle' });

    const compositionPath = path.join(packageDir, 'StructureDefinition-KBV_PR_EAU_Composition.json');
    await writeFile(
      compositionPath,
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Composition',
        version: '1.1.0',
        fhirVersion: '4.0.1',
        type: 'Composition',
      }),
    );

    await expect(loadFromLocalCache(
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Composition|1.1.0',
      [source],
      'R4',
      {},
      indexCache,
    )).resolves.toMatchObject({ type: 'Composition' });

    await rm(compositionPath);
    await expect(loadFromLocalCache(
      'https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Composition|1.1.0',
      [source],
      'R4',
      {},
      indexCache,
    )).resolves.toBeNull();
  });
});
