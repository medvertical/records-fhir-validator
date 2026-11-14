import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { RecordsValidator } from '../validator-engine';
import { ProfileVersionAliases, type ProfileVersionAlias } from '../profile-version-aliases';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance';
import { loadEmbeddedExtensionResourceScope } from '../../validators/extension-embedded-resource-scope';
import { setProfileSource } from '../../persistence';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';

const url = 'http://example.org/StructureDefinition/edition-patient';
const sourceUrl = 'http://example.org/StructureDefinition/source-patient';
const alias: ProfileVersionAlias = { requested: `${url}|1.3`, resolved: `${url}|1.3.1`,
  packageId: 'example.edition#1.3.1', fhirVersion: 'R4', reason: 'Explicit test package edition binding' };
const pins = { 'example.edition': '1.3.1', 'example.source': '2.0.0' };
const folders: string[] = [];
afterEach(async () => { setProfileSource({}); clearCanonicalPinCaches(); await Promise.all(folders.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

async function store(dependency = true) {
  const root = await mkdtemp(join(tmpdir(), 'records-profile-edition-')); folders.push(root);
  for (const [name, version, dependencies, canonical] of [
    ['example.edition', '1.3.1', {}, url],
    ['example.source', '2.0.0', dependency ? { 'example.edition': '1.3.1' } : {}, sourceUrl],
  ] as const) {
    const folder = join(root, `${name}#${version}`, 'package'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }));
    await writeFile(join(folder, 'patient.json'), JSON.stringify({ resourceType: 'StructureDefinition', url: canonical,
      version, name: 'EditionPatient', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
      fhirVersion: '4.0.1', derivation: 'constraint', baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
      snapshot: { element: [{ id: 'Patient', path: 'Patient' },
        { id: 'Patient.active', path: 'Patient.active', min: 1, max: '1', type: [{ code: 'boolean' }] }] } }));
  }
  return root;
}
function loader(root: string, aliases: readonly ProfileVersionAlias[] = [alias]) {
  return new StructureDefinitionLoader(root, null, { profileVersionAliases: aliases, packageVersionPins: pins,
    autoDownload: false, prewarmProfileSource: false, preloadPackageInventory: false });
}

describe('explicit package-bound profile edition aliases', () => {
  it('keeps the generic R4 lookup exact without an explicit binding', async () => {
    const l = loader(await store(), []);
    expect(await l.loadProfile(alias.requested)).toBeNull();
    expect(await l.loadProfile(alias.resolved)).toMatchObject({ version: '1.3.1' });
  });
  it('retains actual business version and issued provenance through lookup, snapshots and batch loading', async () => {
    const l = loader(await store()); const profile = await l.loadProfile(alias.requested);
    expect(profile).toMatchObject({ url, version: '1.3.1' });
    expect(lookupProfilePackageProvenance(profile!)).toEqual({ name: 'example.edition', version: '1.3.1' });
    expect(l.matchesProfileRequest(profile!, alias.requested, 'R4')).toBe(true);
    expect((await l.loadProfilesBatch([alias.requested])).get(alias.requested)).toMatchObject({ version: '1.3.1' });
    expect(await l.loadProfile(`${url}|1.2`)).toBeNull();
    expect(await l.loadProfile(alias.requested, 'R5')).toBeNull();
  });
  it('permits an explicitly named major edition without relaxing other editions', async () => {
    const major = { ...alias, requested: `${url}|1` };
    const l = loader(await store(), [major]);
    expect(await l.loadProfile(major.requested)).toMatchObject({ version: '1.3.1' });
    expect(await l.loadProfile(`${url}|1.3`)).toBeNull();
    expect(await l.loadProfile(`${url}|2`)).toBeNull();
  });
  it('resolves an explicit dependency reference within the referrer package closure', async () => {
    const l = loader(await store());const source = await l.loadProfile(`${sourceUrl}|2.0.0`);
    expect(lookupProfilePackageProvenance(source!)).toEqual({ name: 'example.source', version: '2.0.0' });
    expect(await l.loadReferencedProfile(alias.requested, source)).toMatchObject({ version: '1.3.1' });
    expect(await l.referencedProfileUrl(alias.requested, source)).toBe(alias.resolved);
  });
  it('refuses to borrow the same pinned alias package outside the source dependency closure', async () => {
    const l = loader(await store(false));const source = await l.loadProfile(`${sourceUrl}|2.0.0`);
    expect(source).not.toBeNull();
    expect(lookupProfilePackageProvenance(source!)).toEqual({ name: 'example.source', version: '2.0.0' });
    expect(await l.loadReferencedProfile(alias.requested, source)).toBeNull();
  });
  it('does not let a host definition without package provenance attest the configured alias', async () => {
    const l = loader(await store());const profile = await l.loadProfile(alias.resolved);
    const unissued = JSON.parse(JSON.stringify(profile)); setProfileSource({ findByUrl: async () => unissued });
    expect(await l.loadProfile(alias.requested)).toBeNull();
  });
  it('leaves tenant host resolution exact and does not fall back to a global alias', async () => {
    const l = loader(await store()); setProfileSource({ resolveProfile: async () => null });
    l.setProfileResolutionContext({ organizationId: 17 });
    expect(l.resolveProfileUrl(alias.requested, 'R4')).toBe(alias.requested);
    expect(await l.loadProfile(alias.requested)).toBeNull();
  });
  it('does not mutate the caller binding or accept conflicting package pins', async () => {
    const configured = { ...alias }; const l = loader(await store(), [configured]); configured.resolved = `${url}|1.3.9`;
    expect((await l.loadProfile(alias.requested))?.version).toBe('1.3.1');
    expect(() => new ProfileVersionAliases([alias], { 'example.edition': '9.0.0' })).toThrow('exact pinned package');
  });
  it('deactivates a mapping after its package pin changes', async () => {
    const l = loader(await store()); expect(await l.loadProfile(alias.requested)).not.toBeNull();
    l.setPackageVersionPins({ ...pins, 'example.edition': '1.3.9' });
    expect(l.resolveProfileUrl(alias.requested, 'R4')).toBe(alias.requested);
    expect(await l.loadProfile(alias.requested)).toBeNull();
  });
  it('retains ordinary unversioned pins independently of edition aliases', async () => {
    const l = loader(await store(), []); l.setPinnedCanonicals(new Map([[url, alias.resolved]]));
    expect(await l.loadProfile(url)).toMatchObject({ version: '1.3.1' });
  });
  it.each([
    { ...alias, resolved: 'http://example.org/other|1.3.1' },
    { ...alias, resolved: `${url}|1.4.1` },
    { ...alias, requested: `${url}|1.3.0` },
    { ...alias, requested: 'http://hl7.org/fhir/StructureDefinition/Patient|4.0', resolved: 'http://hl7.org/fhir/StructureDefinition/Patient|4.0.1' },
  ])('refuses unsupported or cross-canonical mappings: $requested -> $resolved', binding => {
    expect(() => new ProfileVersionAliases([binding], pins)).toThrow();
  });
  it('retains verified edition identity when embedded resource extension scopes are loaded', async () => {
    const l = loader(await store());const parent = (await l.loadProfile(`${sourceUrl}|2.0.0`))!;
    const context = { resource: { resourceType: 'Bundle' }, profileSD: parent, profileUrl: parent.url,
      strictMode: true, fhirVersion: 'R4' as const, getValueAtPath: () => undefined };
    const resource = { resourceType: 'Patient', meta: { profile: [alias.requested] } };
    const valid = await loadEmbeddedExtensionResourceScope(resource, 'Bundle.entry[0].resource', context, l);
    expect(valid.incomplete).toBe(false);
    expect(valid.profiles).toContainEqual(expect.objectContaining({ url, version: '1.3.1' }));
    const unknown = await loadEmbeddedExtensionResourceScope({ ...resource, meta: { profile: [`${url}|1.3.99`] } },
      'Bundle.entry[0].resource', context, l);
    expect(unknown.incomplete).toBe(true);
    expect(unknown.profiles).toEqual([]);
    const unbound = await loadEmbeddedExtensionResourceScope(resource, 'Bundle.entry[0].resource', context, loader(await store(), []));
    expect(unbound.incomplete).toBe(true);
    expect(unbound.profiles).toEqual([]);
  });
  it('runs actual profile constraints while leaving the declared input unchanged', async () => {
    const root = await store();const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: null,
      packageVersionPins: pins, profileVersionAliases: [alias], autoDownload: false, prewarmProfileSource: false,
      preloadPackageInventory: false });await validator.waitForInitialization();
    const positive = { resourceType: 'Patient', meta: { profile: [alias.requested] }, active: true };
    const valid = await validator.validate(positive, undefined, 'R4');
    expect(valid.filter(i => i.severity === 'error' || i.severity === 'fatal')).toEqual([]);
    const invalid = await validator.validate({ resourceType: 'Patient', meta: { profile: [alias.requested] } }, undefined, 'R4');
    expect(invalid).toContainEqual(expect.objectContaining({ code: 'structural-cardinality-min', path: 'Patient.active' }));
    expect(positive.meta.profile).toEqual([alias.requested]);
  });
});
