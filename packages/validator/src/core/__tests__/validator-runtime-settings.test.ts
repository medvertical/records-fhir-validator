import { describe, expect, it, vi } from 'vitest';
import type { ValidationSettings } from '../../types';
import {
  applyProfileLoadingSettings,
  buildTerminologyResolutionConfig,
} from '../validator-runtime-settings';
import type { StructureDefinitionLoader } from '../structure-definition-loader';

describe('buildTerminologyResolutionConfig', () => {
  it('passes two-phase expansion settings to the validator runtime', () => {
    const settings = {
      terminologyServers: [{
        id: 'tx',
        url: 'https://tx.example/fhir',
        enabled: true,
        circuitOpen: false,
        fhirVersions: ['R4'],
      }],
      terminologyResolution: {
        strategy: 'local-first',
        twoPhaseExpansion: {
          enabled: true,
          mode: 'shadow',
          logMismatches: true,
        },
      },
    } as ValidationSettings;

    expect(buildTerminologyResolutionConfig(settings).twoPhaseExpansion).toEqual({
      enabled: true,
      mode: 'shadow',
      logMismatches: true,
    });
  });

  it('uses local-only terminology when no enabled, closed server is available', () => {
    const settings = {
      terminologyServers: [{
        id: 'open-circuit',
        url: 'https://tx.example/fhir',
        enabled: true,
        circuitOpen: true,
        fhirVersions: ['R4'],
      }],
      terminologyResolution: {
        strategy: 'server-first',
      },
    } as ValidationSettings;

    const config = buildTerminologyResolutionConfig(settings);

    expect(config.strategy).toBe('local-only');
    expect(config.serverUrl).toBeUndefined();
    expect(config.servers).toEqual([expect.objectContaining({
      id: 'open-circuit',
      circuitOpen: true,
    })]);
  });

  it('selects the first enabled closed terminology server as primary', () => {
    const settings = {
      terminologyServers: [
        {
          id: 'disabled',
          url: 'https://disabled.example/fhir',
          enabled: false,
          circuitOpen: false,
          fhirVersions: ['R4'],
        },
        {
          id: 'primary',
          url: 'https://primary.example/fhir',
          enabled: true,
          circuitOpen: false,
          authConfig: { type: 'bearer', token: 'secret-token' },
          fhirVersions: ['R4'],
        },
      ],
      terminologyResolution: {
        strategy: 'server-first',
        reportUnverifiedBindings: true,
        strictUnverifiedRequiredBindings: true,
      },
    } as ValidationSettings;

    const config = buildTerminologyResolutionConfig(settings);

    expect(config.strategy).toBe('server-first');
    expect(config.serverUrl).toBe('https://primary.example/fhir');
    expect(config.auth).toEqual({ type: 'bearer', token: 'secret-token' });
    expect(config.reportUnverifiedBindings).toBe(true);
    expect(config.strictUnverifiedRequiredBindings).toBe(true);
  });

  it('ignores enabled servers without URL for primary resolution but keeps them for diagnostics', () => {
    const settings = {
      terminologyServers: [
        {
          id: 'missing-url',
          url: '',
          enabled: true,
          circuitOpen: false,
          fhirVersions: ['R4'],
        },
        {
          id: 'healthy',
          url: 'https://healthy.example/fhir',
          enabled: true,
          circuitOpen: false,
          fhirVersions: ['R4'],
        },
      ],
      terminologyResolution: {
        strategy: 'server-first',
        serverDelegation: {
          enabled: true,
          maxRequestsPerRun: 25,
        },
        reportUnverifiedBindings: true,
      },
    } as ValidationSettings;

    const config = buildTerminologyResolutionConfig(settings);

    expect(config.serverUrl).toBe('https://healthy.example/fhir');
    expect(config.strategy).toBe('server-first');
    expect(config.serverDelegation).toEqual({
      enabled: true,
      maxRequestsPerRun: 25,
    });
    expect(config.reportUnverifiedBindings).toBe(true);
    expect(config.servers).toEqual([
      expect.objectContaining({ id: 'missing-url', url: '' }),
      expect.objectContaining({ id: 'healthy', url: 'https://healthy.example/fhir' }),
    ]);
  });
});

describe('applyProfileLoadingSettings', () => {
  it('maps package and profile-source settings to the StructureDefinitionLoader contract', () => {
    let autoDownloadEnabled = true;
    const loader = {
      isAutoDownloadEnabled: vi.fn(() => autoDownloadEnabled),
      setAutoDownload: vi.fn((enabled: boolean) => {
        autoDownloadEnabled = enabled;
      }),
      setProfileSourcesConfig: vi.fn(),
      setAllowedPackages: vi.fn(),
      setPackageVersionPins: vi.fn(),
    } as unknown as StructureDefinitionLoader;

    applyProfileLoadingSettings(loader, {
      packageDownload: {
        autoDownload: false,
        approvedPackages: ['hl7.fhir.us.core', 'de.basisprofil.r4'],
        pinnedVersions: {
          'de.basisprofil.r4': '1.5.4',
        },
      },
      profileSources: {
        simplifier: false,
      },
    } as ValidationSettings);

    expect(loader.setAutoDownload).toHaveBeenCalledWith(false);
    expect(loader.setProfileSourcesConfig).toHaveBeenCalledWith({
      simplifier: false,
      packageRegistry: true,
    });
    expect(loader.setAllowedPackages).toHaveBeenCalledWith(['hl7.fhir.us.core', 'de.basisprofil.r4']);
    expect(loader.setPackageVersionPins).toHaveBeenCalledWith({
      'de.basisprofil.r4': '1.5.4',
    });
  });

  it('does not rewrite auto-download when the setting is omitted or unchanged', () => {
    const loader = {
      isAutoDownloadEnabled: vi.fn(() => true),
      setAutoDownload: vi.fn(),
      setProfileSourcesConfig: vi.fn(),
      setAllowedPackages: vi.fn(),
      setPackageVersionPins: vi.fn(),
    } as unknown as StructureDefinitionLoader;

    applyProfileLoadingSettings(loader, {} as ValidationSettings);
    applyProfileLoadingSettings(loader, {
      packageDownload: { autoDownload: true },
    } as ValidationSettings);

    expect(loader.setAutoDownload).not.toHaveBeenCalled();
  });
});
