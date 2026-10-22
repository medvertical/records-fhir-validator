import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../../persistence/profile-source.js';
import { resolveDefaultBundledProfilesPath } from '../../core/sd-loader-bundled-path.js';
import { TerminologySourceContexts } from '../terminology-source-context.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';

vi.mock('../../core/sd-loader-bundled-path.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../core/sd-loader-bundled-path.js')>();
  return { ...original, resolveDefaultBundledProfilesPath: vi.fn(original.resolveDefaultBundledProfilesPath) };
});

function access() {
  const contexts = new TerminologySourceContexts();
  const resources = new ValueSetPackageResourceAccess();
  resources.bindSourceContexts(contexts);
  return { contexts, resources };
}

describe('request-scoped package directory discovery', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); setProfileSource({}); });

  it('reuses discovery while retaining initiating source stores across overlapping source changes', async () => {
    setProfileSource({ packageDirectories: ['/tmp/first-tenant-store'] });
    const { contexts, resources } = access();
    await contexts.runWith({ organizationId: 7 }, async () => {
      const first = resources.getPackageDirectories();
      first.push('/tmp/caller-injected');
      setProfileSource({ packageDirectories: ['/tmp/second-tenant-store'] });
      await Promise.resolve();
      const second = resources.getPackageDirectories();
      expect(second).toContain('/tmp/first-tenant-store');
      expect(second).not.toContain('/tmp/second-tenant-store');
      expect(second).not.toContain('/tmp/caller-injected');
      expect(resolveDefaultBundledProfilesPath).toHaveBeenCalledOnce();
    });
    contexts.runWith({ organizationId: 8 }, () => {
      expect(resources.getPackageDirectories()).toContain('/tmp/second-tenant-store');
      expect(resolveDefaultBundledProfilesPath).toHaveBeenCalledTimes(2);
    });
  });

  it('observes environment changes even inside an active request and clears discovery with loader state', () => {
    const { contexts, resources } = access();
    contexts.runWith({ organizationId: 7 }, () => {
      vi.stubEnv('FHIR_PACKAGE_CACHE_PATH', '/tmp/first-cache');
      expect(resources.getPackageDirectories().at(-1)).toBe('/tmp/first-cache');
      vi.stubEnv('FHIR_PACKAGE_CACHE_PATH', '/tmp/second-cache');
      expect(resources.getPackageDirectories().at(-1)).toBe('/tmp/second-cache');
      resources.clear();
      expect(resources.getPackageDirectories().at(-1)).toBe('/tmp/second-cache');
      expect(resolveDefaultBundledProfilesPath).toHaveBeenCalledTimes(3);
    });
  });

  it('retains late host installation outside a request and explicit constructor directory ownership', () => {
    const { resources } = access();
    setProfileSource({ packageDirectories: ['/tmp/late-store'] });
    expect(resources.getPackageDirectories()).toContain('/tmp/late-store');
    setProfileSource({ packageDirectories: ['/tmp/new-store'] });
    expect(resources.getPackageDirectories()).toContain('/tmp/new-store');
    const explicit = new ValueSetPackageResourceAccess(['/tmp/explicit']);
    explicit.getPackageDirectories().push('/tmp/caller-injected');
    expect(explicit.getPackageDirectories()).toEqual(['/tmp/explicit']);
  });
});
