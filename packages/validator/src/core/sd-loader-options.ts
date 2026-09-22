import { PackageDownloader } from '../package/package-downloader.js';
import {
  PackageRegistryClient,
} from '../package/package-registry-client.js';
import type { ProfileSourcesConfig } from '@records-fhir/validation-types';
import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import { resolveDefaultBundledProfilesPath } from './sd-loader-bundled-path.js';
import { parseAllowedPackages } from './sd-loader-package-config.js';

export interface StructureDefinitionLoaderOptions {
  autoDownload?: boolean;
  profileSourcesConfig?: ProfileSourcesConfig;
  allowedPackages?: string[];
  packageVersionPins?: Record<string, string>;
  packageDownloader?: PackageDownloader;
  registryClient?: PackageRegistryClient;
  maxCacheEntries?: number;
  prewarmProfileSource?: boolean;
}

export function resolveStructureDefinitionLoaderOptions(
  cachePath: string,
  bundledPath: string | null | undefined,
  options?: StructureDefinitionLoaderOptions,
) {
  const resolvedBundledPath = bundledPath ?? resolveDefaultBundledProfilesPath();
  const registryClient = options?.registryClient ?? new PackageRegistryClient();
  return {
    bundledPath: resolvedBundledPath,
    autoDownload: options?.autoDownload ?? process.env.FHIR_AUTO_DOWNLOAD_PACKAGES === 'true',
    profileSourcesConfig: normalizeProfileSourcesConfig(options?.profileSourcesConfig),
    allowedPackages: [...(options?.allowedPackages ?? parseAllowedPackages())],
    packageVersionPins: { ...(options?.packageVersionPins ?? {}) },
    packageDownloader: options?.packageDownloader ?? new PackageDownloader(cachePath, registryClient),
    registryClient,
    maxCacheEntries: Math.max(1, Math.trunc(options?.maxCacheEntries ?? 192)),
    prewarmProfileSource: options?.prewarmProfileSource !== false,
    packageSources: [...(resolvedBundledPath ? [resolvedBundledPath] : []), cachePath],
  };
}
