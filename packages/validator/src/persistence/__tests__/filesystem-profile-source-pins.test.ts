import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFilesystemProfileSource } from '../filesystem-profile-source';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('request-owned filesystem package pins', () => {
  it('resolves an unversioned imposed profile from the selected IPS package when a newer package is also installed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ips-source-pins-'));
    directories.push(root);
    const canonical = 'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips';
    for (const version of ['2.0.0', '2.0.1']) {
      const directory = path.join(root, `hl7.fhir.uv.ips#${version}`, 'package');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'hl7.fhir.uv.ips', version }));
      await writeFile(path.join(directory, 'StructureDefinition-Bundle-uv-ips.json'), JSON.stringify({
        resourceType: 'StructureDefinition', id: 'Bundle-uv-ips', url: canonical, version,
        fhirVersion: '4.0.1', status: 'active', kind: 'resource', abstract: false, type: 'Bundle',
        snapshot: { element: [{ id: 'Bundle', path: 'Bundle' }] },
      }));
    }
    const pins = { 'hl7.fhir.uv.ips': '2.0.0' };
    const swiss = createFilesystemProfileSource({ packageDirs: [root], packageVersionPins: pins });
    pins['hl7.fhir.uv.ips'] = '2.0.1';
    const international = createFilesystemProfileSource({ packageDirs: [root], packageVersionPins: pins });
    expect((await swiss.findByUrl!(canonical, 'R4'))?.version).toBe('2.0.0');
    expect((await international.findByUrl!(canonical, 'R4'))?.version).toBe('2.0.1');
    expect(await swiss.findByUrl!(`${canonical}|2.0.1`, 'R4')).toBeNull();
    const unavailable = createFilesystemProfileSource({ packageDirs: [root], packageVersionPins: { 'hl7.fhir.uv.ips': '1.0.0' } });
    expect(await unavailable.findByUrl!(canonical, 'R4')).toBeNull();
  });
});
