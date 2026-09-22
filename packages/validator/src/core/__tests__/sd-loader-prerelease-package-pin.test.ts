import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFromLocalCache } from '../sd-loader-filesystem';
import { PackageProfileIndexCache } from '../sd-loader-package-profile-index';

describe('explicit pre-release package selection', () => {
  const directories: string[] = [];
  const canonical = 'http://hl7.eu/fhir/hdr/StructureDefinition/bundle-eu-hdr';
  const packageId = 'hl7.fhir.eu.hdr';

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  async function fixture() {
    const source = await mkdtemp(path.join(tmpdir(), 'records-hdr-pin-'));
    directories.push(source);
    const directory = path.join(source, `${packageId}#0.1.0-ballot`, 'package');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'StructureDefinition-bundle-eu-hdr.json'), JSON.stringify({
      resourceType: 'StructureDefinition', url: canonical, version: '0.1.0-draft',
      fhirVersion: '4.0.1', type: 'Bundle',
    }));
    return source;
  }

  // The package is 0.1.0-ballot while the StructureDefinition inside calls
  // itself 0.1.0-draft. A pin names the package, so the mismatch must not
  // make the pin miss.
  it('honors a package pin independently of the StructureDefinition version', async () => {
    const source = await fixture();
    const cache = new PackageProfileIndexCache();
    const pinned = { [packageId]: '0.1.0-ballot' };
    await expect(loadFromLocalCache(canonical, [source], 'R4', pinned, cache))
      .resolves.toMatchObject({ url: canonical, version: '0.1.0-draft' });
    // Reading the same index again through the shared cache must not change
    // the answer.
    await expect(loadFromLocalCache(canonical, [source], 'R4', pinned, cache))
      .resolves.toMatchObject({ url: canonical, version: '0.1.0-draft' });
  });

  it('does not substitute another release, canonical version, or FHIR version', async () => {
    const source = await fixture();
    const pins = { [packageId]: '0.1.0-ballot' };
    await expect(loadFromLocalCache(canonical, [source], 'R4', {
      [packageId]: '0.2.0-ballot',
    })).resolves.toBeNull();
    await expect(loadFromLocalCache(`${canonical}|0.1.0-ballot`, [source], 'R4', pins)).resolves.toBeNull();
    await expect(loadFromLocalCache(canonical, [source], 'R5', pins)).resolves.toBeNull();
  });
});
