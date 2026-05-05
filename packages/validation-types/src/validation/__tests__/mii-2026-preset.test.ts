import { describe, expect, it } from 'vitest';
import {
  createMii2026ValidationSettings,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS
} from '../index';

describe('MII 2026 validation preset', () => {
  it('keeps the package pin set in sync with the version map', () => {
    expect(MII_2026_PACKAGE_SET).toHaveLength(Object.keys(MII_2026_PACKAGE_VERSIONS).length);
    expect(MII_2026_PACKAGE_SET).toContainEqual({
      id: 'de.medizininformatikinitiative.kerndatensatz.consent',
      version: '2026.0.1-rc-2'
    });
  });

  it('pins every MII 2026 package for deterministic auto-download', () => {
    const settings = createMii2026ValidationSettings();

    for (const { id, version } of MII_2026_PACKAGE_SET) {
      expect(settings.packageDownload?.pinnedVersions[id]).toBe(version);
      expect(settings.packageDownload?.approvedPackages).toContain(id);
    }
  });

  it('configures HAPI parity packages with explicit versions', () => {
    const settings = createMii2026ValidationSettings();

    expect(settings.hapiConfig?.igPackages).toContain(
      'de.medizininformatikinitiative.kerndatensatz.consent#2026.0.1-rc-2'
    );
    expect(settings.profileSources?.packageRegistry).toBe(true);
  });

  it('allows callers to override selected settings without losing package pins', () => {
    const settings = createMii2026ValidationSettings({
      packageDownload: {
        autoDownload: false,
        pinnedVersions: {
          'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1-local'
        }
      }
    });

    expect(settings.packageDownload?.autoDownload).toBe(false);
    expect(settings.packageDownload?.pinnedVersions['de.basisprofil.r4']).toBe('1.5.4');
    expect(settings.packageDownload?.pinnedVersions['de.medizininformatikinitiative.kerndatensatz.laborbefund'])
      .toBe('2026.0.1-local');
  });
});
