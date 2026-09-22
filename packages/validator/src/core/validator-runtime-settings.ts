import type { ValidationSettings } from '@records-fhir/validation-types';
import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import type { TerminologyResolutionConfig } from '../validators/valueset-validator.js';
import { DEFAULT_RESOLUTION_CONFIG } from '../validators/valueset-types.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';

export function expandHomePath(pathStr: string): string {
  if (pathStr.startsWith('$HOME/') || pathStr.startsWith('$HOME\\')) {
    return pathStr.replace('$HOME', process.env.HOME || '/tmp');
  }
  if (pathStr.startsWith('~/')) {
    return pathStr.replace('~', process.env.HOME || '/tmp');
  }
  return pathStr;
}

export function applyProfileLoadingSettings(
  sdLoader: StructureDefinitionLoader,
  settings: ValidationSettings,
): void {
  const autoDownload = settings.packageDownload?.autoDownload;
  if (typeof autoDownload === 'boolean' && sdLoader.isAutoDownloadEnabled() !== autoDownload) {
    sdLoader.setAutoDownload(autoDownload);
  }

  if (settings.profileSources) {
    sdLoader.setProfileSourcesConfig(normalizeProfileSourcesConfig(settings.profileSources));
  }

  if (settings.packageDownload?.approvedPackages) {
    sdLoader.setAllowedPackages(settings.packageDownload.approvedPackages);
  }

  if (settings.packageDownload?.pinnedVersions) {
    sdLoader.setPackageVersionPins(settings.packageDownload.pinnedVersions);
  }
}

export function buildTerminologyResolutionConfig(settings: ValidationSettings): TerminologyResolutionConfig {
  const enabledTerminologyServers = (settings.terminologyServers || []).filter(server =>
    server.enabled && !server.circuitOpen && Boolean(server.url)
  );
  const primaryTerminologyServer = enabledTerminologyServers[0];
  const defaultServerDelegation =
    DEFAULT_RESOLUTION_CONFIG.serverDelegation as NonNullable<TerminologyResolutionConfig['serverDelegation']>;

  return {
    strategy: primaryTerminologyServer
      ? (settings.terminologyResolution?.strategy || 'local-first')
      : 'local-only',
    serverUrl: primaryTerminologyServer?.url,
    auth: primaryTerminologyServer?.authConfig,
    servers: (settings.terminologyServers || []).map(server => ({
      id: server.id,
      url: server.url,
      enabled: server.enabled,
      fhirVersions: server.fhirVersions,
      preferredSystems: server.preferredSystems,
      snomedEditions: server.snomedEditions,
      circuitOpen: server.circuitOpen,
      authConfig: server.authConfig,
    })),
    serverDelegation: {
      ...defaultServerDelegation,
      ...settings.terminologyResolution?.serverDelegation,
    },
    twoPhaseExpansion: settings.terminologyResolution?.twoPhaseExpansion,
    reportUnverifiedBindings: settings.terminologyResolution?.reportUnverifiedBindings ?? true,
    strictUnverifiedRequiredBindings:
      settings.terminologyResolution?.strictUnverifiedRequiredBindings ?? true,
  };
}
