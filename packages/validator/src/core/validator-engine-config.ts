import { expandHomePath } from './validator-runtime-settings';

export interface RecordsValidatorConfig {
  packageCachePath?: string;
  /**
   * Directory holding bundled-profile FHIR packages. When omitted, the
   * SDLoader resolves the path relative to its own source location
   * (`<package-root>/storage/profiles/bundled`), which works both for
   * monorepo workspace dev (the path is a symlink to the in-tree copy)
   * and for an installed npm package (the bundled dir ships inside).
   * `RECORDS_BUNDLED_PROFILES_PATH` (env) overrides when set.
   */
  bundledProfilesPath?: string;
  enableCaching?: boolean;
  strictMode?: boolean;
  timeout?: number;
  autoDownload?: boolean;
  allowedPackages?: string[];
  packageVersionPins?: Record<string, string>;
}

export function resolveRecordsValidatorConfig(config: RecordsValidatorConfig): RecordsValidatorConfig {
  const defaultCachePath = process.env.HOME
    ? `${process.env.HOME}/.fhir/packages`
    : '/tmp/fhir-packages';

  return {
    packageCachePath: expandHomePath(
      config.packageCachePath
      || process.env.FHIR_PACKAGE_CACHE_PATH
      || defaultCachePath
    ),
    enableCaching: config.enableCaching !== false,
    strictMode: config.strictMode || false,
    timeout: config.timeout || 5000,
    autoDownload: config.autoDownload !== false,
    allowedPackages: config.allowedPackages,
    packageVersionPins: config.packageVersionPins,
    bundledProfilesPath: config.bundledProfilesPath || process.env.RECORDS_BUNDLED_PROFILES_PATH,
  };
}
