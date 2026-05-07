import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFromLocalCache } from '../sd-loader-filesystem';

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
});
