import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadExampleFolderProfile } from '../sd-loader-example-profiles';

// CPG's example observations declare chf-egfr, a profile the package ships
// in package/example only.
const CHF_EGFR = 'http://hl7.org/fhir/uv/cpg/StructureDefinition/chf-egfr';
const roots: string[] = [];

async function cpgStore(version = '1.0.0'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'sd-loader-example-'));
  roots.push(root);
  const folder = path.join(root, 'hl7.fhir.uv.cpg#1.0.0', 'package', 'example');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, '.index.json'), JSON.stringify({
    'index-version': 2,
    files: [{ filename: 'StructureDefinition-chf-egfr.json', resourceType: 'StructureDefinition', id: 'chf-egfr', url: CHF_EGFR, version }],
  }));
  await writeFile(path.join(folder, 'StructureDefinition-chf-egfr.json'), JSON.stringify({
    resourceType: 'StructureDefinition', id: 'chf-egfr', url: CHF_EGFR, version, fhirVersion: '4.0.1',
    kind: 'resource', type: 'Observation', derivation: 'constraint',
  }));
  return root;
}

describe('profiles in a package example folder', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('loads a profile that only an example folder defines', async () => {
    const root = await cpgStore();
    await expect(loadExampleFolderProfile(CHF_EGFR, [root], 'R4')).resolves.toMatchObject({ url: CHF_EGFR, version: '1.0.0' });
    await expect(loadExampleFolderProfile(`${CHF_EGFR}|1.0.0`, [root], 'R4')).resolves.toMatchObject({ version: '1.0.0' });
    await expect(loadExampleFolderProfile(`${CHF_EGFR}|1.0.2`, [root], 'R4')).resolves.toBeNull();
    await expect(loadExampleFolderProfile(`${CHF_EGFR}|2.0.0`, [root], 'R4')).resolves.toBeNull();
  });

  it('keeps a profile of another release out', async () => {
    const root = await cpgStore();
    await expect(loadExampleFolderProfile(CHF_EGFR, [root], 'R5')).resolves.toBeNull();
  });
});
