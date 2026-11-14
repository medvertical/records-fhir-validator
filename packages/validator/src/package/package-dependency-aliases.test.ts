import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageDependencyAliases, type PackageDependencyAlias } from './package-dependency-aliases';
import { dependencyClosureEntries } from './canonical-pin-dependency-closure';
import type { InstalledPackageManifest } from './canonical-pin-store';
import { StructureDefinitionLoader } from '../core/structure-definition-loader';
import { lookupProfilePackageProvenance } from './canonical-pin-provenance';
import { clearCanonicalPinCaches } from './canonical-pin-context';

const alias: PackageDependencyAlias = { source: 'example.source#1.0.0', requested: 'example.Target#1.5.0',
  resolved: 'example.target#1.5.0', reason: 'Published dependency spelling differs from issued manifest' };
const pins = { 'example.source': '1.0.0', 'example.target': '1.5.0' };
const ref = (name: string, version: string) => ({ name, version });
const source: InstalledPackageManifest = { ref: ref('example.source', '1.0.0'), canonical: null,
  fhirVersions: ['4.0.1'], dependencies: [ref('example.Target', '1.5.0')], storeRank: 0 };
const target: InstalledPackageManifest = { ...source, ref: ref('example.target', '1.5.0'), dependencies: [] };
const folders: string[] = [];
afterEach(async () => { clearCanonicalPinCaches();await Promise.all(folders.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

describe('explicit package dependency aliases', () => {
  it('keeps generic dependency identity exact and retains the original declared metadata', () => {
    const snapshot = structuredClone(source);
    expect(dependencyClosureEntries([source, target], source.ref, pins, () => false)).toContainEqual({
      status: 'unavailable', ref: ref('example.Target', '1.5.0'), cause: 'dependency-missing',
    });
    const entries = dependencyClosureEntries([source, target], source.ref, pins, () => false, new PackageDependencyAliases([alias], pins));
    expect(entries).toEqual([{ status: 'available', manifest: source }, { status: 'available', manifest: target }]);
    expect(source).toEqual(snapshot);
  });
  it('does not apply an alias to a different source release or dependency release', () => {
    const aliases = new PackageDependencyAliases([alias], pins);
    expect(aliases.resolve(ref('example.source', '2.0.0'), source.dependencies[0], pins)).toBeUndefined();
    expect(aliases.resolve(source.ref, ref('example.Target', '1.5.1'), pins)).toBeUndefined();
    expect(aliases.resolve(ref('example.other', '1.0.0'), source.dependencies[0], pins)).toBeUndefined();
  });
  it('deactivates the binding when live package pins no longer match', () => {
    const aliases = new PackageDependencyAliases([alias], pins);
    expect(aliases.resolve(source.ref, source.dependencies[0], { ...pins, 'example.target': '1.5.1' })).toBeUndefined();
    expect(aliases.resolve(source.ref, source.dependencies[0], { ...pins, 'example.source': '2.0.0' })).toBeUndefined();
  });
  it('refuses an ambiguous store that also contains the declared case variant', () => {
    expect(dependencyClosureEntries([source, target, { ...target, ref: source.dependencies[0] }], source.ref, pins,
      () => false, new PackageDependencyAliases([alias], pins))).toContainEqual({
      status: 'unavailable', ref: source.dependencies[0], cause: 'dependency-alias-ambiguous',
    });
  });
  it('retains an unreadable or identity-mismatched selected manifest as unavailable', () => {
    const broken = { ref: target.ref, storeRank: 0, packageDirectory: '/unavailable', unavailableCause: 'manifest-identity-mismatch' as const };
    expect(dependencyClosureEntries([source, broken], source.ref, pins, () => false,
      new PackageDependencyAliases([alias], pins))).toContainEqual({ status: 'unavailable', ref: target.ref, cause: 'manifest-identity-mismatch' });
  });
  it('retains the configured exact version when only another patch is installed', () => {
    const newer = { ...target, ref: ref('example.target', '1.5.1') };
    expect(dependencyClosureEntries([source, newer], source.ref, pins, () => false,
      new PackageDependencyAliases([alias], pins))).toContainEqual({ status: 'unavailable', ref: target.ref, cause: 'dependency-missing' });
  });
  it('detaches caller-owned bindings and rejects duplicate edges', () => {
    const configured = { ...alias };const aliases = new PackageDependencyAliases([configured], pins);
    configured.resolved = 'example.target#9.0.0';
    expect(aliases.resolve(source.ref, source.dependencies[0], pins)).toEqual(target.ref);
    expect(() => new PackageDependencyAliases([alias, alias], pins)).toThrow('Duplicate');
  });
  it.each([
    { ...alias, resolved: 'example.foreign#1.5.0' }, { ...alias, resolved: 'example.target#1.5.1' },
    { ...alias, source: '../example.source#1.0.0' }, { ...alias, requested: 'example.Target#1.5.x' },
    { ...alias, resolved: 'example.Target#1.5.0' }, { ...alias, source: 'example.other#1.0.0' },
  ])('refuses non-case, unpinned, version-changing or unsafe bindings: $resolved', configured => {
    expect(() => new PackageDependencyAliases([configured], pins)).toThrow();
  });
  it('resolves the actual issued definition through loader lookup and URL pinning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-dependency-alias-'));folders.push(root);
    for (const manifest of [source, target]) {
      const directory = join(root, `${manifest.ref.name}#${manifest.ref.version}`, 'package');await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ ...manifest.ref, fhirVersions: manifest.fhirVersions,
        dependencies: Object.fromEntries(manifest.dependencies.map(d => [d.name, d.version])) }));
      await writeFile(join(directory, 'patient.json'), JSON.stringify({ resourceType: 'StructureDefinition',
        url: `http://example.org/${manifest.ref.name}`, version: manifest.ref.version, name: 'PatientProfile', type: 'Patient',
        status: 'active', kind: 'resource', abstract: false, fhirVersion: '4.0.1',
        snapshot: { element: [{ path: 'Patient' }] } }));
    }
    const options = { packageVersionPins: pins, autoDownload: false, prewarmProfileSource: false, preloadPackageInventory: false };
    const loader = new StructureDefinitionLoader(root, null, { ...options, profileDependencyAliases: [alias] });
    const issued = await loader.loadProfile('http://example.org/example.source|1.0.0');expect(issued).not.toBeNull();
    const selected = await loader.loadReferencedProfile('http://example.org/example.target', issued);
    expect(selected).toMatchObject({ version: '1.5.0' });
    expect(lookupProfilePackageProvenance(selected!)).toEqual(target.ref);
    expect(await loader.pinProfileReference('http://example.org/example.target', issued)).toBe('http://example.org/example.target|1.5.0');
    const strict = new StructureDefinitionLoader(root, null, options);
    await expect(strict.loadReferencedProfile('http://example.org/example.target', issued)).rejects.toMatchObject({
      receipt: expect.objectContaining({ cause: 'dependency-missing' }),
    });
  });
});
