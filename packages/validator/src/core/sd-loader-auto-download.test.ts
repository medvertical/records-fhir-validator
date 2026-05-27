import { beforeEach, describe, expect, it } from 'vitest';
import { attemptAutoDownload, clearAllCaches } from './sd-loader-auto-download';

describe('attemptAutoDownload package pins', () => {
  beforeEach(() => {
    clearAllCaches();
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

  it('does not auto-download FHIR-version-incompatible canonical URLs', async () => {
    let registryCalls = 0;

    const result = await attemptAutoDownload(
      'http://hl7.org/fhir/5.0/StructureDefinition/extension-Observation.value',
      {
        registryClient: {
          detectPackageForProfile: async () => {
            registryCalls++;
            return 'hl7.fhir.uv.xver-r5.r4.r4';
          },
        } as any,
        packageDownloader: {
          downloadAndInstall: async () => {
            throw new Error('should not download');
          },
        } as any,
        allowedPackages: ['hl7.fhir.uv.xver-r5.r4.r4'],
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
});
