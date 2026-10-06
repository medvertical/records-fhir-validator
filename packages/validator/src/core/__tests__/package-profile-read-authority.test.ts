import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { readProfileFileResult } from '../sd-loader-package-profile-reader';
import { scanPackageDirectory } from '../sd-loader-package-source-walker';
import { readPackageReference } from '../profile-reference-package-inventory';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { setProfileSource } from '../../persistence/profile-source';

const roots: string[] = [];
const canonical = 'https://read-authority.test/StructureDefinition/Target';
const parentUrl = 'https://read-authority.test/StructureDefinition/Parent';
const modes = ['replace', 'symlink', 'overwrite', 'directory'] as const;
type Mode = typeof modes[number];
const definition = (url = canonical, min = 1): StructureDefinition => ({ resourceType: 'StructureDefinition',
  url, version: '7.0.0', fhirVersion: '4.0.1', name: 'ReadAuthorityPatient', type: 'Patient', kind: 'resource',
  status: 'active', abstract: false, snapshot: { element: [
    { id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.id', path: 'Patient.id', min: 0, max: '1', type: [{ code: 'id' }] },
    { id: 'Patient.active', path: 'Patient.active', min, max: '1', type: [{ code: 'boolean' }] },
  ] } });
const indexBody = (filename = 'A.json') => JSON.stringify({ files: [{ resourceType: 'StructureDefinition',
  url: canonical, version: '7.0.0', filename }] });
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(indexed = true) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'records-physical-read-'))); roots.push(root);
  const folder = join(root, 'example.targets#1.0.0', 'package'); const foreign = join(root, 'foreign');
  await fs.mkdir(folder, { recursive: true }); await fs.mkdir(foreign);
  await fs.writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'example.targets', version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await fs.writeFile(join(folder, 'A.json'), JSON.stringify(definition()));
  await fs.writeFile(join(foreign, 'A.json'), JSON.stringify(definition(canonical, 0)));
  if (indexed) await fs.writeFile(join(folder, '.index.json'), indexBody());
  return { root, folder, foreign, file: join(folder, 'A.json') };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function change(f: Fixture, mode: Mode) {
  if (mode === 'overwrite') await fs.writeFile(f.file, JSON.stringify(definition(canonical, 0)));
  else if (mode === 'directory') { await fs.rename(f.folder, join(f.root, 'previous')); await fs.symlink(f.foreign, f.folder, 'dir'); }
  else if (mode === 'symlink') { await fs.rm(f.file); await fs.symlink(join(f.foreign, 'A.json'), f.file); }
  else await fs.rename(join(f.foreign, 'A.json'), f.file);
}
function afterStat(file: string, mutation: () => Promise<void>) {
  const stat = fs.stat; let triggered = false;
  vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
    const result = await stat(...args);
    if (!triggered && String(args[0]) === file) { triggered = true; await mutation(); }
    return result;
  });
  return () => triggered;
}
function beforeBytes(file: string, mutation: () => Promise<void>) {
  let triggered = false;
  const mutate = async () => { if (!triggered) { triggered = true; await mutation(); } };
  const readFile = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation(async (name: never, ...rest: never[]) => {
    if (String(name) === file) await mutate(); return readFile(name, ...rest);
  });
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (name: never, flags: never, ...rest: never[]) => {
    const handle = await open(name, flags, ...rest);
    if (String(name) === file) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...args: never[]) => { await mutate(); return read(...args); });
    }
    return handle;
  });
  return () => triggered;
}
const activeMin = (profile: StructureDefinition) => profile.snapshot?.element.find(element => element.path === 'Patient.active')?.min;

describe('physical package profile and index authority', () => {
  it.each([0, 1])('keeps stable actual definition and hash for active min=%s', async min => {
    const f = await fixture(); const bytes = JSON.stringify(definition(canonical, min)); await fs.writeFile(f.file, bytes);
    expect(await readProfileFileResult(f.folder, 'A.json')).toEqual({ status: 'read', profile: definition(canonical, min),
      sha256: createHash('sha256').update(bytes).digest('hex') });
  });
  it.each(modes)('refuses %s between stat and physical open', async mode => {
    const f = await fixture(); const triggered = afterStat(f.file, () => change(f, mode));
    expect(await readProfileFileResult(f.folder, 'A.json')).toMatchObject({ status: 'unavailable', cause: 'source-changed' });
    expect(triggered()).toBe(true);
  });
  it.each([...modes, 'growth'] as const)('refuses %s while reading checked bytes', async mode => {
    const f = await fixture(); const triggered = beforeBytes(f.file, () => mode === 'growth'
      ? fs.truncate(f.file, 32 * 1024 * 1024 + 1) : change(f, mode));
    expect(await readProfileFileResult(f.folder, 'A.json')).toMatchObject({ status: 'unavailable' });
    expect(triggered()).toBe(true);
  });
  it('accepts a stable inner leaf symlink and a stable package alias', async () => {
    const f = await fixture(); await fs.rename(f.file, join(f.folder, 'original.json'));
    await fs.symlink(join(f.folder, 'original.json'), f.file); const alias = join(f.root, 'alias'); await fs.symlink(f.folder, alias, 'dir');
    expect(await readProfileFileResult(alias, 'A.json')).toMatchObject({ status: 'read', profile: definition() });
  });
  it('keeps a foreign leaf unavailable instead of rebasing its package boundary', async () => {
    const f = await fixture(); await fs.rm(f.file); await fs.symlink(join(f.foreign, 'A.json'), f.file);
    expect(await readProfileFileResult(f.folder, 'A.json')).toEqual({ status: 'unavailable', cause: 'unsafe-file' });
  });
  it.each(['missing', 'malformed', 'identity'] as const)('keeps %s source unavailable', async mode => {
    const f = await fixture(); if (mode === 'missing') await fs.rm(f.file);
    else await fs.writeFile(f.file, mode === 'malformed' ? '{broken' : JSON.stringify({ resourceType: 'StructureDefinition', version: 7 }));
    expect(await readProfileFileResult(f.folder, 'A.json')).toMatchObject({ status: 'unavailable' });
  });
  it('retains the 32 MiB profile and 8 MiB index limits', async () => {
    const f = await fixture(); await fs.truncate(f.file, 32 * 1024 * 1024 + 1);
    expect(await readProfileFileResult(f.folder, 'A.json')).toEqual({ status: 'unavailable', cause: 'resource-too-large' });
    await fs.truncate(join(f.folder, '.index.json'), 8 * 1024 * 1024 + 1);
    expect(await readPackageReference(f.folder, canonical, 'R4')).toEqual({ status: 'unavailable', cause: 'index-unreadable' });
  });
  it.each([false, true].flatMap(indexed => modes.map(mode => ({ indexed, mode }))))('keeps $mode as U in actual references (indexed=$indexed)', async ({ indexed, mode }) => {
    const f = await fixture(indexed); const triggered = afterStat(f.file, () => change(f, mode));
    expect(await readPackageReference(f.folder, canonical, 'R4')).toMatchObject({ status: 'unavailable', cause: 'source-changed' });
    expect(triggered()).toBe(true);
  });
  it('refuses an index replaced after its own stat rather than selecting its different profile', async () => {
    const f = await fixture(); await fs.writeFile(join(f.folder, 'B.json'), JSON.stringify(definition(canonical, 0)));
    const replacement = join(f.foreign, '.index.json'); await fs.writeFile(replacement, indexBody('B.json'));
    const triggered = afterStat(join(f.folder, '.index.json'), () => fs.rename(replacement, join(f.folder, '.index.json')));
    expect(await readPackageReference(f.folder, canonical, 'R4')).toEqual({ status: 'unavailable', cause: 'source-changed' });
    expect(triggered()).toBe(true);
  });
  it('refuses a foreign index leaf while real absent indexes still use the actual fallback', async () => {
    const f = await fixture(); const index = join(f.folder, '.index.json'); const foreign = join(f.foreign, '.index.json');
    await fs.writeFile(foreign, indexBody()); await fs.rm(index); await fs.symlink(foreign, index);
    expect(await readPackageReference(f.folder, canonical, 'R4')).toEqual({ status: 'unavailable', cause: 'unsafe-file' });
    await fs.rm(index); const result = await readPackageReference(f.folder, canonical, 'R4');
    expect(result.status).toBe('found'); if (result.status === 'found') expect(activeMin(result.profile)).toBe(1);
  });
});

async function publicFixture(indexed: boolean) {
  const f = await fixture(indexed);
  const core = join(f.root, 'hl7.fhir.r4.core#4.0.1', 'package'); const owner = join(f.root, 'example.owner#1.0.0', 'package');
  await fs.mkdir(core, { recursive: true }); await fs.mkdir(owner, { recursive: true });
  await fs.writeFile(join(core, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1', fhirVersions: ['4.0.1'] }));
  await fs.writeFile(join(core, 'StructureDefinition-Patient.json'), JSON.stringify({ ...definition('http://hl7.org/fhir/StructureDefinition/Patient', 0), version: '4.0.1' }));
  await fs.writeFile(join(owner, 'package.json'), JSON.stringify({ name: 'example.owner', version: '1.0.0', fhirVersions: ['4.0.1'], dependencies: { 'example.targets': '1.0.0' } }));
  await fs.writeFile(join(owner, 'Parent.json'), JSON.stringify({ ...definition(parentUrl), baseDefinition: canonical,
    snapshot: undefined, differential: { element: [{ id: 'Patient', path: 'Patient' }] } }));
  const validator = new RecordsValidator({ packageCachePath: f.root, bundledProfilesPath: f.root, autoDownload: false,
    prewarmProfileSource: false, enableCaching: false, terminologyPackageDirectories: [] }); await validator.waitForInitialization();
  return { ...f, validator };
}
describe('public physical profile-read P/N/U', () => {
  it.each(['single', 'multi'].flatMap(api => [false, true].map(indexed => ({ api, indexed }))))('$api indexed=$indexed retains U plus independent N and reads a changed source freshly', async ({ api, indexed }) => {
    const f = await publicFixture(indexed); const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    const resource = { resourceType: 'Patient', id: 'invalid id' }; const before = structuredClone(resource);
    const run = async () => api === 'single' ? f.validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
      : (await f.validator.validateAspects(resource, { aspects: ['structural', 'profile'], profileUrl: `${parentUrl}|7.0.0`, settings, fhirVersion: 'R4' })).aspects.flatMap(aspect => aspect.issues);
    expect((await run()).some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(true);
    const triggered = afterStat(f.file, () => change(f, 'overwrite')); const unknown = await run(); expect(triggered()).toBe(true);
    expect(unknown.some(issue => issue.details?.validationComplete === false)).toBe(true);
    expect(unknown.some(issue => issue.code === 'structural-invalid-id' && issue.severity === 'error')).toBe(true);
    vi.restoreAllMocks(); const fresh = await run();
    expect(fresh.some(issue => issue.details?.validationComplete === false)).toBe(false);
    expect(fresh.some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(false);
    expect(fresh.some(issue => issue.code === 'structural-invalid-id')).toBe(true); expect(resource).toEqual(before);
    await fs.writeFile(f.file, JSON.stringify(definition()));
    expect((await run()).some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(true);
  });
});

describe('observed index disappearance and actual IG callback reads', () => {
  it.each(['leaf', 'directory'] as const)('keeps an already resolved missing index %s unavailable instead of declaring absence', async stage => {
    const f = await fixture(); const index = join(f.folder, '.index.json'); const realpath = fs.realpath; let triggered = false;
    vi.spyOn(fs, 'realpath').mockImplementation(async (...args) => {
      const result = await realpath(...args);
      if (!triggered && String(args[0]) === index) {
        triggered = true;
        if (stage === 'leaf') await fs.rm(index);
        else await fs.rename(f.folder, join(f.root, 'removed'));
      }
      return result;
    });
    expect(await readPackageReference(f.folder, canonical, 'R4')).toMatchObject({ status: 'unavailable', cause: 'source-changed' });
    expect(triggered).toBe(true);
  });
  it.each(modes)('does not publish %s definition bytes through the actual IG callback', async mode => {
    const f = await fixture(false); const triggered = afterStat(f.file, () => change(f, mode));
    const callback = vi.fn(); const available = new Set<string>(); await scanPackageDirectory(f.folder, available, callback);
    expect(triggered()).toBe(true); expect(callback).not.toHaveBeenCalled(); expect(available.has(canonical)).toBe(false);
  });
  it('keeps stable indexless IG callback P/N bytes and its actual canonical identities', async () => {
    const f = await fixture(false); const callback = vi.fn(); const available = new Set<string>();
    await scanPackageDirectory(f.folder, available, callback);
    expect(callback).toHaveBeenCalledWith(definition()); expect(available).toEqual(new Set([canonical, `${canonical}|7.0.0`]));
  });
});

it('refuses same-path package owner replacement before an index can be declared absent', async () => {
  const f = await fixture(); const stat = fs.stat; let triggered = false;
  vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
    const result = await stat(...args);
    if (!triggered && [f.folder, join(f.folder, '.index.json')].includes(String(args[0]))) {
      triggered = true; await fs.rename(f.folder, join(f.root, 'previous-owner')); await fs.mkdir(f.folder);
      await fs.writeFile(f.file, JSON.stringify(definition(canonical, 0)));
    }
    return result;
  });
  expect(await readPackageReference(f.folder, canonical, 'R4')).toMatchObject({ status: 'unavailable', cause: 'source-changed' });
  expect(triggered).toBe(true);
});

it.each(['inside', 'foreign'] as const)('does not declare an existing dangling %s index link absent', async target => {
  const f = await fixture(false); const index = join(f.folder, '.index.json');
  await fs.symlink(join(target === 'inside' ? f.folder : f.foreign, 'missing-index.json'), index);
  expect((await fs.lstat(index)).isSymbolicLink()).toBe(true);
  expect(await readPackageReference(f.folder, canonical, 'R4')).toMatchObject({ status: 'unavailable', cause: 'unsafe-file' });
  await fs.rm(index);
  expect(await readPackageReference(f.folder, canonical, 'R4')).toMatchObject({ status: 'found', profile: definition() });
});
