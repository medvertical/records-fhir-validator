import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../persistence';
import type { StructureDefinition } from './structure-definition-types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { createValidationDependencySnapshot } from '../validation-dependency-snapshot.js';

describe('StructureDefinitionLoader policy changes', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    setProfileSource({});
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('evicts a profile cached under the previous package version pin', async () => {
    const cacheRoot = await createRoot();
    const canonical = 'https://example.org/fhir/StructureDefinition/pinned-patient';
    await writePackage(cacheRoot, 'example.fhir', '1.0.0', profile(canonical, '1.0.0'));
    await writePackage(cacheRoot, 'example.fhir', '2.0.0', profile(canonical, '2.0.0'));
    const loader = createLoader(cacheRoot);
    await loader.waitForInitialization();

    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '2.0.0' });
    loader.setPackageVersionPins({ 'example.fhir': '1.0.0' });

    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('evicts a core profile cached under the previous release selection', async () => {
    const cacheRoot = await createRoot();
    const canonical = 'http://hl7.org/fhir/StructureDefinition/Patient';
    await writePackage(cacheRoot, 'hl7.fhir.r4.core', '4.0.1', profile(canonical, '4.0.1'));
    await writePackage(cacheRoot, 'hl7.fhir.r4b.core', '4.3.0', profile(canonical, '4.3.0'));
    const loader = createLoader(cacheRoot);
    await loader.waitForInitialization();
    loader.setPackageVersionPins({
      'hl7.fhir.r4.core': '4.0.1',
      'hl7.fhir.r4b.core': '4.3.0',
    });
    loader.setSelectedCorePackage('hl7.fhir.r4.core');

    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '4.0.1' });
    loader.setSelectedCorePackage('hl7.fhir.r4b.core');

    expect(loader.getSelectedCorePackage()).toBe('hl7.fhir.r4b.core');
    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '4.3.0' });
  });

  it('does not let an old in-flight lookup overwrite the new policy cache', async () => {
    const cacheRoot = await createRoot();
    const canonical = 'https://example.org/fhir/StructureDefinition/dynamic-patient';
    const oldProfile = profile(canonical, '2.0.0');
    const newProfile = profile(canonical, '1.0.0');
    let releaseOldLookup!: (value: StructureDefinition) => void;
    const oldLookup = new Promise<StructureDefinition>(resolve => {
      releaseOldLookup = resolve;
    });
    let calls = 0;
    setProfileSource({
      findByUrl: async () => {
        calls++;
        return calls === 1 ? oldLookup : newProfile;
      },
    });
    const loader = createLoader(cacheRoot);
    await loader.waitForInitialization();

    const firstLoad = loader.loadProfile(canonical);
    await vi.waitFor(() => expect(calls).toBe(1));
    loader.setPackageVersionPins({ 'example.fhir': '1.0.0' });
    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '1.0.0' });

    releaseOldLookup(oldProfile);
    await expect(firstLoad).resolves.toMatchObject({ version: '2.0.0' });
    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '1.0.0' });
    expect(calls).toBe(2);
  });

  it('does not let an in-flight lookup repopulate an explicitly cleared cache', async () => {
    const cacheRoot = await createRoot();
    const canonical = 'https://example.org/fhir/StructureDefinition/cleared-patient';
    const staleProfile = profile(canonical, '1.0.0');
    const freshProfile = profile(canonical, '2.0.0');
    let releaseStaleLookup!: () => void;
    const staleLookup = new Promise<StructureDefinition>(resolve => {
      releaseStaleLookup = () => resolve(staleProfile);
    });
    let calls = 0;
    setProfileSource({
      findByUrl: async () => {
        calls++;
        return calls === 1 ? staleLookup : freshProfile;
      },
    });
    const loader = createLoader(cacheRoot);
    await loader.waitForInitialization();

    const firstLoad = loader.loadProfile(canonical);
    await vi.waitFor(() => expect(calls).toBe(1));
    loader.clearCache();
    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '2.0.0' });

    releaseStaleLookup();
    await expect(firstLoad).resolves.toMatchObject({ version: '1.0.0' });
    await expect(loader.loadProfile(canonical)).resolves.toMatchObject({ version: '2.0.0' });
    expect(calls).toBe(2);
  });

  it('defensively copies mutable allowlist and canonical pin inputs', async () => {
    const cacheRoot = await createRoot();
    const loader = createLoader(cacheRoot);
    await loader.waitForInitialization();
    const allowedPackages = ['example.fhir'];
    const pinnedCanonicals = new Map([
      ['https://example.org/fhir/StructureDefinition/patient', 'https://example.org/fhir/StructureDefinition/patient|1.0.0'],
    ]);

    loader.setAllowedPackages(allowedPackages);
    loader.setPinnedCanonicals(pinnedCanonicals);
    const fingerprint = loader.getPinnedCanonicalFingerprint();
    allowedPackages.push('attacker.injected');
    pinnedCanonicals.set(
      'https://example.org/fhir/StructureDefinition/observation',
      'https://example.org/fhir/StructureDefinition/observation|9.9.9',
    );

    expect(loader.getAllowedPackages()).toEqual(['example.fhir']);
    expect(loader.getPinnedCanonicalCount()).toBe(1);
    expect(loader.getPinnedCanonicalFingerprint()).toEqual(fingerprint);
  });

  it('retains initiating tenant/settings for an in-flight reference and isolates host mutations', async () => {
    const loader = createLoader(await createRoot());
    await loader.waitForInitialization();
    const canonical = 'https://example.org/fhir/StructureDefinition/scoped-patient';
    let releaseOld!: () => void;
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
    setProfileSource({ resolveProfile: async (_url, _version, settings, context) => {
      if (context?.organizationId === 7) await oldGate;
      const selected = profile(canonical, String(settings!.performance.batchSize));
      settings!.performance.batchSize = 999;
      return selected;
    } });
    const originalSettings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    originalSettings.performance.batchSize = 10;
    const originalContext = { organizationId: 7 };
    loader.setProfileResolutionContext(originalContext, originalSettings);
    const pending = createValidationDependencySnapshot().run(() => loader.loadReferencedProfile(canonical, null));
    originalContext.organizationId = 99;
    originalSettings.performance.batchSize = 99;
    const nextSettings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    nextSettings.performance.batchSize = 20;
    loader.setProfileResolutionContext({ organizationId: 8 }, nextSettings);
    await expect(loader.loadReferencedProfile(canonical, null)).resolves.toMatchObject({ version: '20' });
    releaseOld();
    await expect(pending).resolves.toMatchObject({ version: '10' });
    loader.clearCache();
    await expect(loader.loadReferencedProfile(canonical, null)).resolves.toMatchObject({ version: '20' });
  });

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'records-loader-policy-'));
    tempDirs.push(root);
    return root;
  }
});

function createLoader(cacheRoot: string): StructureDefinitionLoader {
  return new StructureDefinitionLoader(cacheRoot, null, {
    autoDownload: false,
    prewarmProfileSource: false,
  });
}

function profile(canonical: string, version: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'pinned-patient',
    url: canonical,
    version,
    fhirVersion: '4.0.1',
    type: 'Patient',
    kind: 'resource',
    derivation: 'constraint',
    snapshot: { element: [] },
  };
}

async function writePackage(
  cacheRoot: string,
  packageId: string,
  version: string,
  structureDefinition: StructureDefinition,
): Promise<void> {
  const packageDir = path.join(cacheRoot, `${packageId}#${version}`, 'package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageId, version, fhirVersions: ['4.0.1'] }),
  );
  await writeFile(
    path.join(packageDir, 'StructureDefinition-pinned-patient.json'),
    JSON.stringify(structureDefinition),
  );
}
