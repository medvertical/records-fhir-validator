import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultValidationSettings } from '@records-fhir/validation-types';
import { setProfileSource } from '../persistence/profile-source.js';
import { StructureDefinitionLoader } from './structure-definition-loader.js';
import { checkSnapshotProfile, withSnapshotProfileChecks } from './snapshot-profile-checks.js';
import { normalizeKnownStructureDefinitionCanonicalUrl, normalizeVersionedCoreStructureDefinitionUrl, urlMatchesRequestedFhirVersion } from './sd-loader-version-utils.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { recordProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { withSelectedProfileDefinition } from './profile-reference-authority.js';

afterEach(() => setProfileSource({}));
describe('snapshot profile enforcement', () => {
  it('checks an already selected package definition at its exact edition while retaining global selection guards', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'records-sdk-selected-profile-'));
    try {
      const selected = { resourceType: 'StructureDefinition' as const, url: 'https://example.test/p', version: '1',
        name: 'Selected', type: 'Patient', kind: 'resource', abstract: false, status: 'active' };
      recordProfilePackageProvenance(selected, 'example.profile#1.0.0');
      const resolve = vi.fn(async () => ({ ...selected, version: '2' }));
      const check = vi.fn(async (request: string, profile: { version?: string; status?: unknown } | null) => {
        if (request !== `${selected.url}|1` || profile?.version !== '1' || profile.status !== 'active') throw new Error('Profile selection changed');
      });
      setProfileSource({ resolveProfile: resolve, assertSnapshotProfile: check });
      const loader = new StructureDefinitionLoader(directory, null, { autoDownload: false, prewarmProfileSource: false });
      await loader.waitForInitialization();
      loader.setProfileResolutionContext({ organizationId: 1, serverId: 491, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) });
      expect(await withSelectedProfileDefinition(selected, 'R4', () => loader.loadProfile(selected.url))).toMatchObject({ version: '1' });
      expect(resolve).not.toHaveBeenCalled();
      await expect(withSelectedProfileDefinition({ ...selected, status: 'draft' }, 'R4', () => loader.loadProfile(selected.url)))
        .rejects.toThrow('Profile selection changed');
      await expect(loader.loadProfile(selected.url)).rejects.toThrow('Profile selection changed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('replays an explicit unavailable decision without consulting profile sources and keeps conformance unverified', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'records-sdk-missing-profile-'));
    try {
      const resolve = vi.fn(async () => { throw new Error('Mutable source must not be consulted'); });
      const check = vi.fn(async () => {});
      setProfileSource({ resolveProfile: resolve, assertSnapshotProfile: check,
        isSnapshotProfileUnavailable: async request => request === 'https://example.test/missing' });
      const loader = new StructureDefinitionLoader(directory, null, { autoDownload: false, prewarmProfileSource: false });
      await loader.waitForInitialization();
      loader.setProfileResolutionContext({ organizationId: 1, serverId: 491, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) });
      expect(await loader.loadProfile('https://example.test/missing')).toBeNull();
      expect(await loader.loadReferencedProfile('https://example.test/missing', { url: 'https://example.test/parent' })).toBeNull();
      expect(resolve).not.toHaveBeenCalled();
      expect(check).toHaveBeenCalledTimes(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('checks nested input declarations and extension identities before validation without forwarding clinical fields', async () => {
    const context = { organizationId: 1, serverId: 491, terminologySnapshotSha256: 'a'.repeat(64) };
    const claims = vi.fn(async () => {});
    setProfileSource({ assertSnapshotProfileClaims: claims });
    await withSnapshotProfileChecks(context, async () => true, [{ resourceType: 'Patient', name: [{ family: 'private' }],
      contained: [{ resourceType: 'Observation', meta: { profile: ['https://example.test/new'] },
        extension: [{ url: 'https://example.test/extension', extension: [{ url: 'relative-part', valueString: 'private' }] },
          { url: 'urn:oid:1.2.3' }] }] }]);
    expect(claims).toHaveBeenCalledWith(['http://hl7.org/fhir/StructureDefinition/Patient', 'http://hl7.org/fhir/StructureDefinition/Observation',
      'https://example.test/new', 'https://example.test/extension', 'urn:oid:1.2.3'], context);
    claims.mockRejectedValueOnce(new Error('Unknown claim'));
    await expect(withSnapshotProfileChecks(context, async () => {
      try { await withSnapshotProfileChecks(context, async () => true, [{}]); } catch { /* Embedded-resource errors may become issues. */ }
      return true;
    })).rejects.toThrow('Unknown claim');
  });
  it('retains caught violations until the outer operation completes and isolates concurrent runs', async () => {
    const context = { organizationId: 1, serverId: 491, terminologySnapshotSha256: 'a'.repeat(64) };
    setProfileSource({ assertSnapshotProfile: async () => { throw new Error('Profile changed'); } });
    await expect(withSnapshotProfileChecks(context, async () => {
      try { await withSnapshotProfileChecks(context, () => checkSnapshotProfile('https://example.test/p', null, context)); } catch { /* A validator may return a load issue. */ }
      return 'apparently-complete';
    })).rejects.toThrow('Profile changed');
    expect(await withSnapshotProfileChecks({ ...context, terminologySnapshotSha256: 'b'.repeat(64) }, async () => 'unaffected')).toBe('unaffected');
  });

  it('checks repeated loader results and referenced definitions under settings-derived snapshot context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'records-sdk-profile-scope-'));
    try {
      const profile = { resourceType: 'StructureDefinition' as const, url: 'https://example.test/p', version: '1', type: 'Patient' };
      const check = vi.fn(async () => {});
      setProfileSource({ resolveProfile: async () => profile, assertSnapshotProfile: check });
      const loader = new StructureDefinitionLoader(directory, null, { autoDownload: false, prewarmProfileSource: false });
      await loader.waitForInitialization();
      const settings = createDefaultValidationSettings('R4');
      settings.terminologyResolution!.snapshot = { sha256: 'a'.repeat(64) };
      loader.setProfileResolutionContext({ organizationId: 1, serverId: 491, fhirVersion: 'R4' }, settings);
      await loader.loadProfile(profile.url);
      await loader.loadProfile(profile.url);
      await loader.loadReferencedProfile(profile.url, profile);
      expect(check).toHaveBeenCalledTimes(3);
      expect(check.mock.calls[0]).toEqual([profile.url, profile, expect.objectContaining({ terminologySnapshotSha256: 'a'.repeat(64) }), undefined]);
      check.mockRejectedValueOnce(new Error('Profile changed'));
      await expect(loader.loadProfile(profile.url)).rejects.toThrow('Profile changed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps R4 cross-version profile identity and the distinct ICU ECT canonical', () => {
    const url = 'http://hl7.org/fhir/5.0/StructureDefinition/profile-Composition';
    expect(urlMatchesRequestedFhirVersion(url, 'R4')).toBe(true);
    expect(normalizeVersionedCoreStructureDefinitionUrl(url, 'R4')).toBe(url);
    expect(profileMatchesCanonical({ resourceType: 'StructureDefinition', url, fhirVersion: '4.0.1' }, url, 'R4')).toBe(true);
    expect(profileMatchesCanonical({ resourceType: 'StructureDefinition', url, fhirVersion: '5.0.0' }, url, 'R4')).toBe(false);
    const icu = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-ect-arterieller-druck';
    expect(normalizeKnownStructureDefinitionCanonicalUrl(icu)).toBe(icu);
    expect(profileMatchesCanonical({ resourceType: 'StructureDefinition', url: icu.replace('-ect-', '-') }, icu, 'R4')).toBe(false);
  });
});
