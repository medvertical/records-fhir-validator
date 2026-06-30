import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRelevantPackage, loadFromLocalCache } from '../sd-loader-filesystem';

describe('sd-loader-filesystem', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
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

  it('does not resolve unversioned canonicals to pre-release profiles', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'sd-loader-'));
    tempDirs.push(source);

    await writeProfile(source, 'hl7.fhir.us.qicore#8.0.0-ballot', '8.0.0-ballot');

    await expect(
      loadFromLocalCache(
        'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-procedure',
        [source],
        'R4',
      ),
    ).resolves.toBeNull();
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

  it('resolves unversioned EPS canonicals to the agreed xtehr pre-release package', async () => {
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
});
