import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanPackageDirectory } from '../sd-loader-package-scanner';

describe('sd-loader-package-scanner', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('indexes versioned canonical aliases for local StructureDefinitions', async () => {
    const packageDir = await mkdtemp(path.join(tmpdir(), 'sd-loader-package-'));
    tempDirs.push(packageDir);

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'StructureDefinition-mii-pr-patho-attached-image.json'),
      JSON.stringify({
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image',
        version: '2026.0.0',
        fhirVersion: '4.0.1',
        type: 'Media',
      }),
    );

    const availableProfiles = new Set<string>();
    await scanPackageDirectory(packageDir, availableProfiles);

    expect(availableProfiles.has(
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image',
    )).toBe(true);
    expect(availableProfiles.has(
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-attached-image|2026.0.0',
    )).toBe(true);
  });
});
