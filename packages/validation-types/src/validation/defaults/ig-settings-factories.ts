// Factory functions building MII 2026 / EHDS 2026 preset settings.

import type { ValidationSettings } from '../settings';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from './base-settings';
import {
  type Mii2026ValidationSettingsOverrides,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  MII_2026_IG_PACKAGES,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  HL7_EU_EHDS_2026_IG_PACKAGES,
} from './ig-packages';

/**
 * Create an R4 validation settings object for the MII 2026 package set.
 *
 * The preset keeps the standard Records validator behavior but pins every
 * MII package version used by the 2026 conformance target so automatic package
 * downloads and optional HAPI parity runs resolve deterministic IG versions.
 */
export function createMii2026ValidationSettings(
  overrides: Mii2026ValidationSettingsOverrides = {}
): ValidationSettings {
  const settings = JSON.parse(JSON.stringify(DEFAULT_VALIDATION_SETTINGS_R4)) as ValidationSettings;
  const approvedPackages = new Set([
    ...(settings.packageDownload?.approvedPackages ?? []),
    ...MII_2026_PACKAGE_SET.map(({ id }) => id)
  ]);

  settings.packageDownload = {
    versionPolicy: settings.packageDownload?.versionPolicy ?? 'prefer-stable',
    pinnedVersions: {
      ...(settings.packageDownload?.pinnedVersions ?? {}),
      ...MII_2026_PACKAGE_VERSIONS
    },
    approvedPackages: Array.from(approvedPackages),
    requireApproval: settings.packageDownload?.requireApproval ?? false,
    autoDownload: settings.packageDownload?.autoDownload ?? true
  };

  settings.profileSources = {
    simplifier: true,
    packageRegistry: true
  };

  settings.hapiConfig = {
    enabled: settings.hapiConfig?.enabled ?? false,
    timeout: settings.hapiConfig?.timeout ?? 30000,
    igPackages: MII_2026_IG_PACKAGES,
    useProcessPool: settings.hapiConfig?.useProcessPool ?? true,
    poolSize: settings.hapiConfig?.poolSize ?? 3,
    cachePath: settings.hapiConfig?.cachePath ?? '/tmp/fhir-packages',
    enableBestPractice: settings.hapiConfig?.enableBestPractice ?? true
  };
  settings.mii = {
    preset: 'mii-2026',
    terminologyMode: 'mii-local-blaze',
    maxOntoserverRequestsPerRun: 250,
    allowHighVolumeOntoserver: false
  };

  return {
    ...settings,
    ...overrides,
    mii: {
      ...settings.mii,
      ...overrides.mii
    },
    packageDownload: {
      ...settings.packageDownload,
      ...overrides.packageDownload,
      pinnedVersions: {
        ...settings.packageDownload.pinnedVersions,
        ...overrides.packageDownload?.pinnedVersions
      },
      approvedPackages: overrides.packageDownload?.approvedPackages ?? settings.packageDownload.approvedPackages
    },
    profileSources: {
      ...settings.profileSources,
      ...overrides.profileSources
    },
    hapiConfig: {
      ...settings.hapiConfig,
      ...overrides.hapiConfig
    }
  };
}

/**
 * Create an R4 validation settings object for EHDS-oriented data tests.
 *
 * The EHDS lane builds on the MII 2026 baseline because German EHDS pilots
 * need the same local terminology and KDS package behavior, then adds the
 * HL7 Europe package pins used by cross-border EHDS scenarios.
 */
export function createEhds2026ValidationSettings(
  overrides: Mii2026ValidationSettingsOverrides = {}
): ValidationSettings {
  const settings = createMii2026ValidationSettings();
  const approvedPackages = new Set([
    ...(settings.packageDownload?.approvedPackages ?? []),
    ...HL7_EU_EHDS_2026_PACKAGE_SET.map(({ id }) => id)
  ]);

  settings.packageDownload = {
    versionPolicy: settings.packageDownload?.versionPolicy ?? 'prefer-stable',
    pinnedVersions: {
      ...(settings.packageDownload?.pinnedVersions ?? {}),
      ...HL7_EU_EHDS_2026_PACKAGE_VERSIONS
    },
    approvedPackages: Array.from(approvedPackages),
    requireApproval: settings.packageDownload?.requireApproval ?? false,
    autoDownload: settings.packageDownload?.autoDownload ?? true
  };

  settings.hapiConfig = {
    enabled: settings.hapiConfig?.enabled ?? false,
    timeout: settings.hapiConfig?.timeout ?? 30000,
    igPackages: [...MII_2026_IG_PACKAGES, ...HL7_EU_EHDS_2026_IG_PACKAGES],
    useProcessPool: settings.hapiConfig?.useProcessPool ?? true,
    poolSize: settings.hapiConfig?.poolSize ?? 3,
    cachePath: settings.hapiConfig?.cachePath ?? '/tmp/fhir-packages',
    enableBestPractice: settings.hapiConfig?.enableBestPractice ?? true
  };

  settings.mii = {
    preset: 'ehds-2026',
    terminologyMode: settings.mii?.terminologyMode ?? 'mii-local-blaze',
    packageLockHash: settings.mii?.packageLockHash,
    maxOntoserverRequestsPerRun: settings.mii?.maxOntoserverRequestsPerRun,
    allowHighVolumeOntoserver: settings.mii?.allowHighVolumeOntoserver
  };

  return {
    ...settings,
    ...overrides,
    mii: {
      ...settings.mii,
      ...overrides.mii,
      terminologyMode: overrides.mii?.terminologyMode ?? settings.mii.terminologyMode,
      preset: 'ehds-2026'
    },
    packageDownload: {
      ...settings.packageDownload,
      ...overrides.packageDownload,
      pinnedVersions: {
        ...settings.packageDownload.pinnedVersions,
        ...overrides.packageDownload?.pinnedVersions
      },
      approvedPackages: overrides.packageDownload?.approvedPackages ?? settings.packageDownload.approvedPackages
    },
    profileSources: {
      simplifier: overrides.profileSources?.simplifier ?? settings.profileSources?.simplifier ?? true,
      packageRegistry: overrides.profileSources?.packageRegistry ?? settings.profileSources?.packageRegistry ?? true
    },
    hapiConfig: {
      ...settings.hapiConfig,
      ...overrides.hapiConfig
    }
  };
}
