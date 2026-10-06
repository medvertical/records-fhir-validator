import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';

const parentUrl = 'http://example.org/parity/StructureDefinition/Parent';
const childUrl = 'http://example.org/parity/StructureDefinition/Child';
const ownedRoots: string[] = [];

afterEach(async () => {
  clearCanonicalPinCaches();
  await Promise.all(ownedRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(ownerVersion: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'records-package-origin-'));
  ownedRoots.push(root);
  const packages = path.join(root, 'packages');
  const bundled = path.join(root, 'bundled');
  await mkdir(bundled);
  await writePackage(packages, 'example.owner', ownerVersion, { 'example.child': ownerVersion }, parentUrl, '1.0.0');
  await writePackage(packages, 'example.child', '1.0.0', {}, childUrl, '1.0.0');
  await writePackage(packages, 'example.child', '2.0.0', {}, childUrl, '2.0.0');
  const loader = new StructureDefinitionLoader(packages, bundled, { autoDownload: false, prewarmProfileSource: false });
  await loader.waitForInitialization();
  const parent = await loader.loadProfile(`${parentUrl}|1.0.0`, 'R4');
  if (!parent) throw new Error('Fixture parent unavailable');
  return { loader, parent };
}

async function writePackage(
  store: string, name: string, version: string, dependencies: Record<string, string>, url: string, businessVersion: string,
) {
  const directory = path.join(store, `${name}#${version}`, 'package');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }));
  const definition = {
    resourceType: 'StructureDefinition', id: businessVersion, url, version: businessVersion, name: 'Profile',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient', derivation: 'constraint',
    snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' }] },
  };
  await writeFile(path.join(directory, 'StructureDefinition-Profile.json'), JSON.stringify(definition));
}

describe('package provenance of independent loaded profiles', () => {
  it('retains the first loader dependency after a second loader resolves equal canonical and business version', async () => {
    const first = await fixture('1.0.0');
    expect((await first.loader.loadReferencedProfile(childUrl, first.parent, 'R4'))?.version).toBe('1.0.0');
    const second = await fixture('2.0.0');
    expect((await second.loader.loadReferencedProfile(childUrl, second.parent, 'R4'))?.version).toBe('2.0.0');
    expect((await first.loader.loadReferencedProfile(childUrl, first.parent, 'R4'))?.version).toBe('1.0.0');
  });

  it('does not give a host profile the provenance of an unrelated installed profile with equal canonical and version', async () => {
    const installed = await fixture('1.0.0');
    const host = { url: parentUrl, version: '1.0.0' };
    expect((await installed.loader.loadReferencedProfile(childUrl, host, 'R4'))?.version).toBe('2.0.0');
  });

  it('preserves another loader origin when one loader clears its profile cache', async () => {
    const retained = await fixture('1.0.0');
    const cleared = await fixture('2.0.0');
    cleared.loader.clearCache();
    expect((await retained.loader.loadReferencedProfile(childUrl, retained.parent, 'R4'))?.version).toBe('1.0.0');
  });

  it('preserves package origin across the shallow snapshots used by validator callers', async () => {
    const first = await fixture('1.0.0');
    const snapshot = { ...first.parent };
    await fixture('2.0.0');
    expect((await first.loader.loadReferencedProfile(childUrl, snapshot, 'R4'))?.version).toBe('1.0.0');
  });

  it.each([['1.0.0', '2.0.0'], ['2.0.0', '1.0.0']])('isolates concurrent lookups in order %s then %s', async (a, b) => {
    const first = await fixture(a);
    const second = await fixture(b);
    for (let round = 0; round < 2; round++) {
      const profiles = await Promise.all([first, second].map(({ loader, parent }) => loader.loadReferencedProfile(childUrl, parent, 'R4')));
      expect(profiles.map(profile => profile?.version)).toEqual([a, b]);
    }
  });

  it('treats a serialized host/DB copy as unpinned without modifying FHIR JSON', async () => {
    const installed = await fixture('1.0.0');
    const serialized = JSON.stringify(installed.parent);
    const host = JSON.parse(serialized) as typeof installed.parent;
    expect((await installed.loader.loadReferencedProfile(childUrl, host, 'R4'))?.version).toBe('2.0.0');
    expect(JSON.stringify(installed.parent)).toBe(serialized);
    expect(Object.keys(installed.parent)).not.toContain('profilePackageOrigin');
  });
});
