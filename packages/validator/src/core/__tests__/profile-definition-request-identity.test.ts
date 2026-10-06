import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileCache } from '../../cache/profile-cache';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { setProfileSource } from '../../persistence';
import { RecordsValidator } from '../validator-engine';
import { loadProfileWithSnapshot, loadProfileForValidation } from '../profile-snapshot-loading';
import { preloadProfiles } from '../profile-batch-preloader';
import { storeExternalProfile } from '../sd-loader-external-profile-cache';
import { cacheDownloadedProfile } from '../sd-loader-downloaded-profile-cache';
import { checkDatabaseCache } from '../sd-loader-db-cache';
import { resolveTenantProfileFromSource } from '../tenant-profile-source-resolution';
import { AutoDownloadState } from '../sd-loader-auto-download';
import { loadProfilesBatchWithCache } from '../sd-loader-batch-loader';
import { loadProfile, type LoadProfileContext } from '../sd-loader-load';
import { profileMatchesCanonical } from '../sd-loader-profile-identity';
import { loadFromLocalCache } from '../sd-loader-filesystem';
import { loadExampleFolderProfile } from '../sd-loader-example-profiles';
import type { StructureDefinition } from '../structure-definition-types';

const canonical = 'https://example.test/StructureDefinition/EditionPatient';
const roots: string[] = [];
const definition = (version = '2026.0.0', url = canonical, fhirVersion = '4.0.1', active = true): StructureDefinition => ({
  resourceType: 'StructureDefinition', id: `patient-${version}`, url, version, fhirVersion, name: 'EditionPatient',
  status: 'active', kind: 'resource', abstract: false, type: 'Patient', derivation: 'constraint',
  snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.active', path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }], fixedBoolean: active }] },
});
const context = (cache = new Map<string, StructureDefinition>()): LoadProfileContext => ({
  availableProfiles: new Set(), packageSources: [], cache, profileLoadPromises: new Map(), autoDownload: false, autoDownloadState: new AutoDownloadState(),
  registryClient: {} as never, packageDownloader: {} as never, allowedPackages: [], packageVersionPins: {},
  profileSourcesConfig: { simplifier: false, packageRegistry: false }, resolvePinnedCanonical: url => url,
});
async function store(profiles: StructureDefinition[], examples = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'records-profile-identity-')); roots.push(root);
  const release = String(profiles[0].fhirVersion); const family = release.startsWith('5.') ? 'r5' : 'r4';
  const folder = path.join(root, 'test.profile-editions#1.0.0', 'package', ...(examples ? ['example'] : []));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(root, 'test.profile-editions#1.0.0', 'package', 'package.json'),
    JSON.stringify({ name: 'test.profile-editions', version: '1.0.0', fhirVersions: [release] }));
  await Promise.all(profiles.map((profile, index) => writeFile(path.join(folder, `StructureDefinition-${index}.json`), JSON.stringify(profile))));
  await writeFile(path.join(folder, '.index.json'), JSON.stringify({ 'index-version': 2, files: profiles.map((profile, index) => ({
    filename: `StructureDefinition-${index}.json`, resourceType: 'StructureDefinition', url: profile.url, version: profile.version,
  })) }));
  const core = definition(release, 'http://hl7.org/fhir/StructureDefinition/Patient', release);
  delete core.snapshot!.element[1].fixedBoolean;
  const coreFolder = path.join(root, `hl7.fhir.${family}.core#${release}`, 'package'); await mkdir(coreFolder, { recursive: true });
  await writeFile(path.join(coreFolder, 'package.json'), JSON.stringify({ name: `hl7.fhir.${family}.core`, version: release, fhirVersions: [release] }));
  await writeFile(path.join(coreFolder, 'StructureDefinition-Patient.json'), JSON.stringify(core));
  await writeFile(path.join(coreFolder, '.index.json'), JSON.stringify({ 'index-version': 2,
    files: [{ filename: 'StructureDefinition-Patient.json', resourceType: 'StructureDefinition', url: core.url, version: core.version }] }));
  return root;
}
afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches(); vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('a requested definition is fulfilled by its actual identity', () => {
  it.each([
    ['full-version-miss', definition('2026.0.3'), `${canonical}|2026.0.0`],
    ['missing-version', { ...definition(), version: undefined }, `${canonical}|2026.0.0`],
    ['wrong-canonical', definition('2026.0.0', `${canonical}-other`), canonical],
    ['URI-case', definition('2026.0.0', canonical.toLowerCase()), canonical],
    ['literal-business-version', definition('2.7.0'), `${canonical}|2.7`],
    ['wrong-FHIR', definition('2026.0.0', canonical, '5.0.0'), canonical],
    ['unsupported-FHIR', definition('2026.0.0', canonical, '3.0.2'), canonical],
    ['malformed-FHIR', definition('2026.0.0', canonical, '4.invalid'), canonical],
    ['empty-request', definition(), ''],
    ['whitespace-canonical', definition(), `${canonical} `],
    ['double-pipe', definition(), `${canonical}|2026.0.0|2026.0.0`],
    ['empty-edition', definition(), `${canonical}|`],
    ['whitespace-edition', definition(), `${canonical}| 2026.0.0`],
    ['label-miss', definition('2026.0.0-ballot2'), `${canonical}|2026.0.0-ballot1`],
  ] as const)('rejects %s without attesting an alternative', (_kind, profile, requested) => {
    expect(profileMatchesCanonical(profile, requested, 'R4')).toBe(false);
  });
  it('preserves an exact author-managed short version and an absent optional FHIR field', () => {
    expect(profileMatchesCanonical({ ...definition('2.7'), fhirVersion: undefined }, `${canonical}|2.7`, 'R4')).toBe(true);
  });
  it('allows an R5 partial selection without equating a full edition with another patch', () => {
    expect(profileMatchesCanonical(definition('2.7.3', canonical, '5.0.0'), `${canonical}|2.7`, 'R5')).toBe(true);
    expect(profileMatchesCanonical(definition('2.7.3-draft', canonical, '5.0.0'), `${canonical}|2.7`, 'R5')).toBe(true);
    expect(profileMatchesCanonical(definition('2.7.3', canonical, '5.0.0'), `${canonical}|2.7.0`, 'R5')).toBe(false);
  });
  it.each(['https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-ect-bilanz',
    'http://hl7.org/fhir/us/core/StructureDefinition/us-core-genderidentity'])('keeps an undocumented canonical alias unresolved: %s', requested => {
    const actual = requested.includes('modul-icu') ? requested.replace('-ect-', '-') : requested.replace('genderidentity', 'genderIdentity');
    expect(profileMatchesCanonical(definition('1.0.0', actual), requested, 'R4')).toBe(false);
    expect(profileMatchesCanonical(definition('1.0.0', actual), actual, 'R4')).toBe(true);
  });
  it('keeps genuine cross-version extension identity rather than changing its source-release URL', () => {
    const url = 'http://hl7.org/fhir/5.0/StructureDefinition/extension-AuditEvent.category';
    expect(profileMatchesCanonical(definition('1.0.0', url), url, 'R4')).toBe(true);
  });
  it.each([false, true])('takes the exact package edition independent of package file order (%s)', async reverse => {
    const profiles = [definition('2026.0.0'), definition('2026.0.3', canonical, '4.0.1', false)];
    const root = await store(reverse ? profiles.reverse() : profiles);
    await expect(loadFromLocalCache(`${canonical}|2026.0.0`, [root], 'R4')).resolves.toMatchObject({ version: '2026.0.0' });
    await expect(loadFromLocalCache(`${canonical}|2026.0.2`, [root], 'R4')).resolves.toBeNull();
    await expect(loadFromLocalCache(canonical, [root], 'R4')).resolves.toMatchObject({ version: '2026.0.3' });
  });
  it.each([false, true])('does not replace a full edition in package or example storage (%s)', async examples => {
    const root = await store([definition('2026.0.3')], examples);
    const load = examples ? loadExampleFolderProfile : loadFromLocalCache;
    await expect(load(`${canonical}|2026.0.0`, [root], 'R4')).resolves.toBeNull();
    await expect(load(canonical, [root], 'R4')).resolves.toMatchObject({ version: '2026.0.3' });
  });
  it('selects a genuine R5 partial package edition and retains full misses', async () => {
    const root = await store([definition('2.7.1', canonical, '5.0.0'), definition('2.7.3', canonical, '5.0.0')]);
    await expect(loadFromLocalCache(`${canonical}|2.7`, [root], 'R5')).resolves.toMatchObject({ version: '2.7.3' });
    await expect(loadFromLocalCache(`${canonical}|2.7.0`, [root], 'R5')).resolves.toBeNull();
  });
  it.each([definition('2026.0.3'), definition('2026.0.0', `${canonical}-other`), definition('2026.0.0', canonical, '5.0.0')])('does not trust a mismatched loader memory hit ($url | $version)', async cached => {
      const requested = `${canonical}|2026.0.0`; const ctx = context(new Map([[`${requested}:R4`, cached]]));
      await expect(loadProfile(ctx, requested, 'R4')).resolves.toBeNull();
    });
  it('does not permit a configured edition pin to change the original canonical', async () => {
    const other = `${canonical}-other`; const ctx = context(new Map([[`${other}|2026.0.0:R4`, definition('2026.0.0', other)]]));
    ctx.resolvePinnedCanonical = () => `${other}|2026.0.0`;
    await expect(loadProfile(ctx, canonical, 'R4')).resolves.toBeNull();
  });
  it('revalidates both cached and newly returned batch identities', async () => {
    const requested = `${canonical}|2026.0.0`; const wrong = definition('2026.0.3');
    const cache = new Map([[`${requested}:R4`, wrong]]);
    const result = await loadProfilesBatchWithCache({ urls: [requested], fhirVersion: 'R4', cache,
      resolvePinnedCanonical: url => url, loadProfile: vi.fn().mockResolvedValue(wrong) });
    expect(result.size).toBe(0);
  });
  it.each(['cached', 'loaded'] as const)('does not trust %s snapshot identity', async mode => {
    const requested = `${canonical}|2026.0.0`; const cache = new ProfileCache();
    if (mode === 'cached') cache.set(`${requested}:R4:snapshot`, definition('2026.0.3'));
    const loader = { loadProfile: vi.fn().mockResolvedValue(mode === 'loaded' ? definition('2026.0.3') : null) };
    const generator = { generateSnapshot: vi.fn() };
    await expect(loadProfileWithSnapshot(loader as never, cache, generator as never, requested, 'R4')).resolves.toBeNull();
    await expect(loadProfileForValidation(loader as never, generator as never, requested, 'R4', cache)).resolves.toBeNull();
    expect(generator.generateSnapshot).not.toHaveBeenCalled();
  });
  it.each([false, true])('public Single/Multi use exact P/N and preserve U in one runtime (%s)', async unknownFirst => {
    const root = await store([definition('2026.0.0'), definition('2026.0.3', canonical, '4.0.1', false)]);
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: true });
    await validator.waitForInitialization();
    expect(await validator.isProfileSupported(`${canonical}|2026.0.0`, 'R4')).toBe(true);
    const kinds = unknownFirst ? ['unknown', 'positive', 'negative'] : ['positive', 'negative', 'unknown'];
    for (const kind of kinds) {
      const resource = { resourceType: 'Patient', active: kind !== 'negative' };
      const requested = `${canonical}|${kind === 'unknown' ? '2026.0.2' : '2026.0.0'}`;
      const single = await validator.validate(resource, requested, 'R4');
      const multi = await validator.validateAspects(resource, { profileUrl: requested, fhirVersion: 'R4', aspects: ['structural', 'profile'],
        settings: DEFAULT_VALIDATION_SETTINGS_R4 });
      for (const issues of [single, multi.aspects.flatMap(aspect => aspect.issues)]) {
        const errors = issues.filter(issue => issue.severity === 'error');
        if (kind === 'unknown') {
          expect(issues.some(issue => issue.details?.validationComplete === false || issue.code.includes('unverified'))).toBe(true);
          expect(errors).toEqual([]);
        } else if (kind === 'negative') expect(errors.some(issue => issue.code === 'profile-fixed-value-mismatch' && issue.path.endsWith('active')), JSON.stringify(errors)).toBe(true);
        else expect(errors).toEqual([]);
      }
    }
  });
  it.each(['external', 'download', 'database', 'tenant', 'preloader'] as const)(
    '%s rejects wrong identities and can subsequently fulfill the exact request', async way => {
      const requested = `${canonical}|2026.0.0`;
      const cache = new Map<string, StructureDefinition>(); const availableProfiles = new Set<string>();
      const externalProfileCacheKeys = new Set<string>(); const profileLoadPromises = new Map();
      const candidate = { current: definition('2026.0.3') };
      setProfileSource({ findByUrl: async () => candidate.current, resolveProfile: async () => candidate.current });
      const invoke = async () => {
        if (way === 'external') return storeExternalProfile({ url: requested, profile: candidate.current, fhirVersion: 'R4',
          cache, availableProfiles, externalProfileCacheKeys, profileLoadPromises });
        if (way === 'download') return cacheDownloadedProfile(requested, candidate.current,
          { cache, availableProfiles, fhirVersion: 'R4' } as never);
        if (way === 'database') return checkDatabaseCache(requested, 'R4');
        if (way === 'tenant') return resolveTenantProfileFromSource(requested, 'R4', { organizationId: 11 });
        const snapshots = new ProfileCache();
        await preloadProfiles({ loadProfilesBatch: async () => new Map([[requested, candidate.current]]),
          cacheProfile: vi.fn() } as never, snapshots, { generateSnapshot: vi.fn() } as never, [requested], 'R4');
        return snapshots.get(`${requested}:R4:snapshot`) ?? null;
      };
      for (const wrong of [definition('2026.0.3'), definition('2026.0.0', `${canonical}-other`),
        definition('2026.0.0', canonical, '5.0.0'), definition('2026.0.0', canonical, '3.0.2')]) {
        candidate.current = wrong;
        expect(await invoke()).toBe(way === 'external' ? false : null);
        expect(cache.size).toBe(0); expect(availableProfiles.size).toBe(0);
      }
      candidate.current = definition(); expect(await invoke()).toBeTruthy();
    });
  it.each(['with-snapshot', 'for-validation', 'preloader'] as const)(
    '%s uses the selected bare definition rather than a foreign snapshot edition', async way => {
      const selected = { ...definition('2026.0.0'), snapshot: undefined,
        differential: definition().snapshot, baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient' };
      const snapshots = new ProfileCache(); const key = `${canonical}:R4:snapshot`;
      snapshots.set(key, definition('2026.0.3', canonical, '4.0.1', false));
      const generator = { generateSnapshot: vi.fn().mockResolvedValue(definition().snapshot!.element) };
      const loader = { loadProfile: vi.fn().mockResolvedValue(selected), loadProfilesBatch: async () => new Map([[canonical, selected]]) };
      if (way === 'with-snapshot') await loadProfileWithSnapshot(loader as never, snapshots, generator as never, canonical, 'R4');
      else if (way === 'for-validation') await loadProfileForValidation(loader as never, generator as never, canonical, 'R4', snapshots);
      else await preloadProfiles(loader as never, snapshots, generator as never, [canonical], 'R4');
      expect(generator.generateSnapshot).toHaveBeenCalledWith(selected, { fhirVersion: 'R4' });
      expect(snapshots.get(key)).toMatchObject({ version: '2026.0.0', snapshot: { element: definition().snapshot!.element } });
    });
  it('reflects canonical pin changes and missing editions through the public snapshot API in one runtime', async () => {
    const root = await store([definition('2026.0.0'), definition('2026.0.3', canonical, '4.0.1', false)]);
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: true });
    await validator.waitForInitialization();
    for (const version of ['2026.0.0', '2026.0.3', '2026.0.2', '2026.0.0']) {
      validator.setPinnedCanonicals(new Map([[canonical, `${canonical}|${version}`]]));
      const loaded = await validator.loadProfileWithSnapshot(canonical, 'R4');
      if (version === '2026.0.2') expect(loaded).toBeNull();
      else expect(loaded).toMatchObject({ url: canonical, version,
        snapshot: { element: definition(version, canonical, '4.0.1', version !== '2026.0.3').snapshot!.element } });
      await expect(validator.loadProfileWithSnapshot(`${canonical}|2026.0.0`, 'R4')).resolves.toMatchObject({ version: '2026.0.0' });
    }
  });

  it.each(['R5', 'R6'] as const)('keeps major/minor partial selection and rejects malformed release metadata under %s', family => {
    const release = family === 'R5' ? '5.0.0' : '6.0.0-ballot3';
    const profile = definition('2.7.3-draft', canonical, release);
    expect(profileMatchesCanonical(profile, `${canonical}|2`, family)).toBe(true);
    expect(profileMatchesCanonical(profile, `${canonical}|2.7`, family)).toBe(true);
    expect(profileMatchesCanonical(profile, `${canonical}|2.8`, family)).toBe(false);
    expect(profileMatchesCanonical(profile, `${canonical}|2.7.0`, family)).toBe(false);
    expect(profileMatchesCanonical({ ...profile, fhirVersion: `${family.slice(1)}.invalid` }, canonical, family)).toBe(false);
    expect(profileMatchesCanonical({ ...profile, fhirVersion: `${family.slice(1)}.` }, canonical, family)).toBe(false);
  });
  it('keeps a tenant pin miss authoritative even when the host could supply a different bare edition', async () => {
    const root = await store([definition('2026.0.3')]);
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: true });
    await validator.waitForInitialization();
    const resolveProfile = vi.fn(async (_url: string, version?: string) =>
      version === '2026.0.0' ? null : definition('2026.0.3'));
    setProfileSource({ resolveProfile });
    const loader = validator.getSdLoader(); loader.setProfileResolutionContext({ organizationId: 11 });
    validator.setPinnedCanonicals(new Map([[canonical, `${canonical}|2026.0.0`]]));
    await expect(loadProfileForValidation(loader, {} as never, canonical, 'R4', new ProfileCache())).resolves.toBeNull();
    expect(resolveProfile.mock.calls.every(([, version]) => version === '2026.0.0')).toBe(true);
    validator.setPinnedCanonicals(new Map([[canonical, `${canonical}|2026.0.3`]]));
    await expect(loadProfileForValidation(loader, {} as never, canonical, 'R4', new ProfileCache())).resolves.toMatchObject({ version: '2026.0.3' });
    validator.setPinnedCanonicals(new Map([[canonical, `${canonical}|2026.0.0`]]));
    const scoped = new ProfileCache(); scoped.set(`${canonical}:R4:snapshot`, definition('2026.0.3'));
    await expect(loadProfileForValidation(loader, {} as never, canonical, 'R4', scoped)).resolves.toBeNull();
  });

});
