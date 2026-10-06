import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptAutoDownload,
  AutoDownloadState,
  clearAllCaches,
} from './sd-loader-auto-download';
import { setProfileSource } from '../persistence';

describe('attemptAutoDownload package pins', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  afterEach(() => {
    setProfileSource({});
    clearAllCaches();
    vi.useRealTimers();
  });

  it('passes pinned package versions to the downloader', async () => {
    let requestedVersion: string | undefined;

    const result = await attemptAutoDownload('https://example.org/fhir/StructureDefinition/PinnedProfile', {
      registryClient: {
        detectPackageForProfile: async () => 'de.medizininformatikinitiative.kerndatensatz.laborbefund'
      } as any,
      packageDownloader: {
        downloadAndInstall: async (_packageId: string, version?: string) => {
          requestedVersion = version;
          return {
            success: true,
            packageId: _packageId,
            version: version ?? 'latest',
            installedPath: '/tmp/records-fhir-validator-test'
          };
        }
      } as any,
      allowedPackages: ['de.medizininformatikinitiative.*'],
      packageVersionPins: {
        'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1'
      },
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true
      },
      fhirVersion: 'R4'
    });

    expect(result).toBeNull();
    expect(requestedVersion).toBe('2026.0.1');
  });

  it('uses explicit canonical versions as the package version when no pin exists', async () => {
    let requestedVersion: string | undefined;

    const result = await attemptAutoDownload('https://fhir.kbv.de/StructureDefinition/KBV_PR_EAU_Bundle|1.1.0', {
      registryClient: {
        detectPackageForProfile: async () => 'kbv.ita.eau'
      } as any,
      packageDownloader: {
        downloadAndInstall: async (_packageId: string, version?: string) => {
          requestedVersion = version;
          return {
            success: true,
            packageId: _packageId,
            version: version ?? 'latest',
            installedPath: '/tmp/records-fhir-validator-test'
          };
        }
      } as any,
      allowedPackages: ['kbv.ita.eau'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true
      },
      fhirVersion: 'R4'
    });

    expect(result).toBeNull();
    expect(requestedVersion).toBe('1.1.0');
  });

  it('does not auto-download FHIR-version-incompatible canonical URLs', async () => {
    let registryCalls = 0;

    const result = await attemptAutoDownload(
      'http://hl7.org/fhir/5.0/StructureDefinition/vitalsigns',
      {
        registryClient: {
          detectPackageForProfile: async () => {
            registryCalls++;
            return 'hl7.fhir.r5.core';
          },
        } as any,
        packageDownloader: {
          downloadAndInstall: async () => {
            throw new Error('should not download');
          },
        } as any,
        allowedPackages: ['hl7.fhir.r5.core'],
        packageSources: ['/tmp/records-fhir-validator-test'],
        cache: new Map(),
        availableProfiles: new Set(),
        profileSourcesConfig: {
          simplifier: false,
          packageRegistry: true,
        },
        fhirVersion: 'R4',
      },
    );

    expect(result).toBeNull();
    expect(registryCalls).toBe(0);
  });

  it('does not let a miss for one vendor profile suppress sibling canonicals', async () => {
    let registryCalls = 0;

    const context = {
      registryClient: {
        detectPackageForProfile: async () => {
          registryCalls++;
          return null;
        },
      } as any,
      packageDownloader: {
        downloadAndInstall: async () => {
          throw new Error('should not download');
        },
      } as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true,
      },
      fhirVersion: 'R4' as const,
    };

    await expect(attemptAutoDownload(
      'https://emr-core.beda.software/StructureDefinition/help-text',
      context,
    )).resolves.toBeNull();
    await expect(attemptAutoDownload(
      'https://emr-core.beda.software/StructureDefinition/inline-choice-direction',
      context,
    )).resolves.toBeNull();

    expect(registryCalls).toBe(2);
  });

  it('keeps known package namespaces out of generic scope caching', async () => {
    let registryCalls = 0;

    const context = {
      registryClient: {
        detectPackageForProfile: async () => {
          registryCalls++;
          return null;
        },
      } as any,
      packageDownloader: {
        downloadAndInstall: async () => {
          throw new Error('should not download');
        },
      } as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true,
      },
      fhirVersion: 'R4' as const,
    };

    await expect(attemptAutoDownload(
      'http://hl7.org/fhir/us/core/StructureDefinition/MissingA',
      context,
    )).resolves.toBeNull();
    await expect(attemptAutoDownload(
      'http://hl7.org/fhir/us/core/StructureDefinition/MissingB',
      context,
    )).resolves.toBeNull();

    expect(registryCalls).toBe(2);
  });

  it('does not scope-cache when a package candidate was detected', async () => {
    let registryCalls = 0;

    const context = {
      registryClient: {
        detectPackageForProfile: async () => {
          registryCalls++;
          return 'example.fhir.package';
        },
      } as any,
      packageDownloader: {
        downloadAndInstall: async (packageId: string) => ({
          success: true,
          packageId,
          version: '1.0.0',
          installedPath: '/tmp/records-fhir-validator-test',
        }),
      } as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true,
      },
      fhirVersion: 'R4' as const,
    };

    await expect(attemptAutoDownload(
      'https://example.org/fhir/StructureDefinition/MissingA',
      context,
    )).resolves.toBeNull();
    await expect(attemptAutoDownload(
      'https://example.org/fhir/StructureDefinition/MissingB',
      context,
    )).resolves.toBeNull();

    expect(registryCalls).toBe(2);
  });

  it('scopes per-profile misses to the active source policy', async () => {
    let registryCalls = 0;
    const baseContext = {
      registryClient: {
        detectPackageForProfile: async () => {
          registryCalls++;
          return null;
        },
      } as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      fhirVersion: 'R4' as const,
    };
    const url = 'https://example.org/fhir/StructureDefinition/Dynamic';

    await expect(attemptAutoDownload(url, {
      ...baseContext,
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: false,
      },
    })).resolves.toBeNull();
    await expect(attemptAutoDownload(url, {
      ...baseContext,
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true,
      },
    })).resolves.toBeNull();

    expect(registryCalls).toBe(1);
  });

  it('retries a canonical after the embedder replaces its profile source', async () => {
    const url = 'https://example.org/fhir/StructureDefinition/Dynamic';
    const profile = {
      resourceType: 'StructureDefinition',
      id: 'dynamic',
      url,
      type: 'Patient',
      fhirVersion: '4.0.1',
    };
    const context = {
      registryClient: {} as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: true,
        packageRegistry: false,
      },
      fhirVersion: 'R4' as const,
    };

    setProfileSource({ fetchExternalProfile: async () => null });
    await expect(attemptAutoDownload(url, context)).resolves.toBeNull();

    setProfileSource({ fetchExternalProfile: async () => profile as any });
    await expect(attemptAutoDownload(url, context)).resolves.toMatchObject({
      id: 'dynamic',
      url,
    });
  });

  it('does not negative-cache a transient profile source failure', async () => {
    const url = 'https://example.org/fhir/StructureDefinition/Transient';
    const fetchExternalProfile = vi.fn().mockRejectedValue(new Error('temporary secret response'));
    const context = {
      registryClient: {} as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: true,
        packageRegistry: false,
      },
      fhirVersion: 'R4' as const,
    };
    setProfileSource({ fetchExternalProfile });

    await expect(attemptAutoDownload(url, context)).resolves.toBeNull();
    await expect(attemptAutoDownload(url, context)).resolves.toBeNull();

    expect(fetchExternalProfile).toHaveBeenCalledTimes(2);
  });

  it('rejects an external StructureDefinition for a different canonical', async () => {
    const requestedUrl = 'https://example.org/fhir/StructureDefinition/Requested';
    const context = {
      registryClient: {} as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: true,
        packageRegistry: false,
      },
      fhirVersion: 'R4' as const,
    };
    setProfileSource({
      fetchExternalProfile: async () => ({
        resourceType: 'StructureDefinition',
        id: 'other',
        url: 'https://example.org/fhir/StructureDefinition/Other',
        type: 'Patient',
        fhirVersion: '4.0.1',
      } as any),
    });

    await expect(attemptAutoDownload(requestedUrl, context)).resolves.toBeNull();
    expect(context.cache.size).toBe(0);
    expect(context.availableProfiles.size).toBe(0);
  });

  it('does not mutate caches when a timed-out external lookup resolves late', async () => {
    vi.useFakeTimers();
    const url = 'https://example.org/fhir/StructureDefinition/Late';
    let resolveExternal!: (profile: any) => void;
    const externalResult = new Promise<any>(resolve => {
      resolveExternal = resolve;
    });
    const context = {
      registryClient: {} as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: true,
        packageRegistry: false,
      },
      fhirVersion: 'R4' as const,
    };
    setProfileSource({ fetchExternalProfile: async () => externalResult });

    const result = attemptAutoDownload(url, context);
    await vi.advanceTimersByTimeAsync(20_001);
    await expect(result).resolves.toBeNull();

    resolveExternal({
      resourceType: 'StructureDefinition',
      id: 'late',
      url,
      type: 'Patient',
      fhirVersion: '4.0.1',
    });
    await Promise.resolve();
    expect(context.cache.size).toBe(0);
    expect(context.availableProfiles.size).toBe(0);
  });

  it('does not restore a cleared miss or delete the replacement pending request', async () => {
    const gates: Array<() => void> = [];
    let registryCalls = 0;
    const autoDownloadState = new AutoDownloadState();
    const context = {
      registryClient: {
        detectPackageForProfile: async () => {
          registryCalls++;
          await new Promise<void>(resolve => gates.push(resolve));
          return null;
        },
      } as any,
      packageDownloader: {} as any,
      allowedPackages: ['*'],
      packageSources: ['/tmp/records-fhir-validator-test'],
      cache: new Map(),
      availableProfiles: new Set(),
      profileSourcesConfig: {
        simplifier: false,
        packageRegistry: true,
      },
      fhirVersion: 'R4' as const,
      autoDownloadState,
    };
    const url = 'https://example.org/fhir/StructureDefinition/Cleared';

    const staleRequest = attemptAutoDownload(url, context);
    await vi.waitFor(() => expect(registryCalls).toBe(1));
    clearAllCaches(autoDownloadState);
    const replacementRequest = attemptAutoDownload(url, context);
    await vi.waitFor(() => expect(registryCalls).toBe(2));

    gates[0]?.();
    await expect(staleRequest).resolves.toBeNull();
    const joinedRequest = attemptAutoDownload(url, context);
    expect(registryCalls).toBe(2);
    gates[1]?.();
    await expect(Promise.all([replacementRequest, joinedRequest])).resolves.toEqual([null, null]);

    clearAllCaches(autoDownloadState);
    const retry = attemptAutoDownload(url, context);
    await vi.waitFor(() => expect(registryCalls).toBe(3));
    gates[2]?.();
    await expect(retry).resolves.toBeNull();
  });
});
