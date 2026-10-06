import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tarStream from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageDownloader } from '../package/package-downloader';
import { PackageRegistryClient } from '../package/package-registry-client';
import { clearCanonicalPinCaches } from '../package/canonical-pin-context';
import { setProfileSource } from '../persistence';
import { ExtensionUrlResolver } from '../validators/extension-url-resolver';
import { validateUniversalExtensionRules } from '../validators/extension-universal-rules';
import type { ExtensionValidationContext } from '../validators/extension-types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { ProfileReferenceUnavailableError } from './profile-reference-authority';
import type { StructureDefinition } from './structure-definition-types';

const CANONICAL = 'https://example.test/fhir/StructureDefinition/extension';
const PACKAGE = 'example.extensions';
const VERSION = '1.0.0';
const BASE_PROFILE: StructureDefinition = {
  resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/StructureDefinition/Patient',
  name: 'Patient', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
  fhirVersion: '4.0.1', snapshot: { element: [{ id: 'Patient', path: 'Patient' }] },
};
const EXTENSION_PROFILE: StructureDefinition = {
  resourceType: 'StructureDefinition', id: 'example-extension', url: CANONICAL, version: VERSION,
  name: 'ExampleExtension', status: 'active', kind: 'complex-type', abstract: false, type: 'Extension',
  fhirVersion: '4.0.1', context: [{ type: 'element', expression: 'Patient' }],
  snapshot: { element: [{ id: 'Extension', path: 'Extension' }] },
};

const stores: string[] = [];
beforeEach(() => setProfileSource({}));
afterEach(async () => {
  setProfileSource({});
  clearCanonicalPinCaches();
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map(store => rm(store, { recursive: true, force: true })));
});

async function packageArchive(manifestName = PACKAGE, includeDefinition = true): Promise<Buffer> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on('error', reject);
  });
  pack.entry({ name: 'package/package.json' }, JSON.stringify({
    name: manifestName, version: VERSION, fhirVersions: ['4.0.1'],
  }));
  if (includeDefinition) {
    pack.entry({ name: 'package/StructureDefinition-example-extension.json' }, JSON.stringify(EXTENSION_PROFILE));
    pack.entry({ name: 'package/.index.json' }, JSON.stringify({ 'index-version': 2, files: [{
      filename: 'StructureDefinition-example-extension.json', resourceType: 'StructureDefinition',
      url: CANONICAL, version: VERSION,
    }] }));
  }
  pack.finalize();
  return complete;
}

async function harness() {
  const store = await mkdtemp(path.join(tmpdir(), 'records-download-authority-'));
  stores.push(store);
  const registry = new PackageRegistryClient();
  const detect = vi.spyOn(registry, 'detectPackageForProfile').mockResolvedValue(PACKAGE);
  vi.spyOn(registry, 'getPackageInfo').mockResolvedValue({
    packageId: PACKAGE, version: VERSION, tarballUrl: 'https://example.test/package.tgz',
  });
  const download = vi.spyOn(registry, 'downloadPackageTarball').mockResolvedValue(await packageArchive());
  const downloader = new PackageDownloader(store, registry);
  const loader = new StructureDefinitionLoader(store, store, {
    autoDownload: true, prewarmProfileSource: false, allowedPackages: [PACKAGE],
    profileSourcesConfig: { simplifier: false, packageRegistry: true },
    registryClient: registry, packageDownloader: downloader,
  });
  await loader.waitForInitialization();
  const resolver = new ExtensionUrlResolver(loader);
  return { loader, resolver, detect, download };
}

function extensionIssues(resolver: ExtensionUrlResolver, key: 'extension' | 'modifierExtension',
  extension: Record<string, unknown> = { url: CANONICAL, valueString: 'value' }) {
  const context: ExtensionValidationContext = {
    resource: { resourceType: 'Patient', [key]: [extension] }, profileSD: BASE_PROFILE,
    strictMode: false, fhirVersion: 'R4', profileUrl: BASE_PROFILE.url, getValueAtPath: () => undefined,
  };
  return validateUniversalExtensionRules({
    extension, extensionType: key, path: `Patient.${key}[0]`, knownUrls: new Set(), context,
    visited: new Set(), depth: 0, maxNestedExtensionDepth: 0,
    resolveExtensionUrl: (url, family) => resolver.resolveKnown(url, family, BASE_PROFILE),
    getDeclaredContexts: (url, family) => resolver.getDeclaredContexts(url, family, BASE_PROFILE),
    site: { resourceType: 'Patient', elementPath: 'Patient', attachment: 'resource-root' },
  });
}

function expectIncomplete(issues: Awaited<ReturnType<typeof extensionIssues>>) {
  expect(issues.some(issue => issue.code === 'profile-extension-not-found')).toBe(false);
  expect(issues).toContainEqual(expect.objectContaining({
    code: 'profile-reference-unavailable', severity: 'information',
    details: expect.objectContaining({ canonical: CANONICAL, cause: 'auto-download-source-unavailable',
      validationComplete: false, validationStatus: 'incomplete' }),
  }));
}

describe('referenced extension authority through actual auto-download fallback', () => {
  it.each(['extension', 'modifierExtension'] as const)('keeps a rejected package manifest incomplete for %s', async key => {
    const h = await harness();
    h.download.mockResolvedValue(await packageArchive('foreign.extensions'));

    expectIncomplete(await extensionIssues(h.resolver, key));
    expect(h.download).toHaveBeenCalled();
    await expect(h.loader.loadProfile(CANONICAL, 'R4')).resolves.toBeNull();
  });

  it('retains transport failure and independently invalid extension structure', async () => {
    const h = await harness();
    h.download.mockRejectedValue(new Error('private upstream response'));
    const issues = await extensionIssues(h.resolver, 'modifierExtension', { url: CANONICAL });

    expectIncomplete(issues);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-extension-no-value', severity: 'error' }));
    expect(JSON.stringify(issues)).not.toContain('private upstream response');
  });

  it('retains external source failure through the same reference fallback', async () => {
    const h = await harness();
    h.loader.setProfileSourcesConfig({ simplifier: true, packageRegistry: false });
    const fetchExternalProfile = vi.fn().mockRejectedValue(new Error('external source unavailable'));
    setProfileSource({ fetchExternalProfile });

    expectIncomplete(await extensionIssues(h.resolver, 'extension'));
    expect(fetchExternalProfile).toHaveBeenCalled();
    expect(h.download).not.toHaveBeenCalled();
  });

  it('does not negative-cache a failed installation and resolves a succeeding retry', async () => {
    const h = await harness();
    h.download.mockResolvedValueOnce(await packageArchive('foreign.extensions'));

    await expect(h.loader.loadReferencedProfile(CANONICAL, BASE_PROFILE, 'R4'))
      .rejects.toBeInstanceOf(ProfileReferenceUnavailableError);
    await expect(h.resolver.resolveKnown(CANONICAL, 'R4', BASE_PROFILE)).resolves.toBe('resolvable');
    expect(h.download).toHaveBeenCalledTimes(2);
  });

  it.each(['extension', 'modifierExtension'] as const)('accepts an installed available definition for %s', async key => {
    const h = await harness();
    const issues = await extensionIssues(h.resolver, key);

    expect(issues).toEqual([]);
    expect(h.download).toHaveBeenCalledTimes(1);
    await expect(h.loader.loadReferencedProfile(CANONICAL, BASE_PROFILE, 'R4')).resolves.toMatchObject({ url: CANONICAL });
  });

  it.each(['extension', 'modifierExtension'] as const)('keeps a definitive registry miss as an unresolved %s', async key => {
    const h = await harness();
    h.detect.mockResolvedValue(null);
    const issues = await extensionIssues(h.resolver, key);

    expect(issues).toEqual([expect.objectContaining({ code: 'profile-extension-not-found', severity: 'error' })]);
    expect(h.download).not.toHaveBeenCalled();
  });

  it('keeps an installed package without the requested definition as a definitive miss', async () => {
    const h = await harness();
    h.download.mockResolvedValue(await packageArchive(PACKAGE, false));

    const issues = await extensionIssues(h.resolver, 'modifierExtension');
    expect(issues).toEqual([expect.objectContaining({ code: 'profile-extension-not-found', severity: 'error' })]);
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('does not let a concurrent legacy null erase a shared download failure', async () => {
    const h = await harness();
    let releaseDownload!: () => void;
    const blockedDownload = new Promise<void>(resolve => { releaseDownload = resolve; });
    h.download.mockImplementation(async () => {
      await blockedDownload;
      throw new Error('offline');
    });
    const legacy = h.loader.loadProfile(CANONICAL, 'R4');
    const reference = h.loader.loadReferencedProfile(CANONICAL, BASE_PROFILE, 'R4');
    const referenceResult = expect(reference).rejects.toBeInstanceOf(ProfileReferenceUnavailableError);
    await vi.waitFor(() => expect(h.download).toHaveBeenCalledTimes(1));
    releaseDownload();

    await expect(legacy).resolves.toBeNull();
    await referenceResult;
    expect(h.download).toHaveBeenCalledTimes(1);
  });
});
