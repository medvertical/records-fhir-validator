import { expandHomePath } from './validator-runtime-settings.js';

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
  bundledProfilesPath?: string | null;
  enableCaching?: boolean;
  strictMode?: boolean;
  timeout?: number;
  autoDownload?: boolean;
  allowedPackages?: string[];
  packageVersionPins?: Record<string, string>;
  profileCacheMaxEntries?: number;
  /** Skip eager database profile loading for short-lived scoped validators. */
  prewarmProfileSource?: boolean;
}

const DEFAULT_PROFILE_CACHE_MAX_ENTRIES = 192;

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
    profileCacheMaxEntries: resolvePositiveInteger(
      config.profileCacheMaxEntries,
      process.env.VALIDATOR_PROFILE_CACHE_MAX_ENTRIES,
      DEFAULT_PROFILE_CACHE_MAX_ENTRIES,
    ),
    prewarmProfileSource: config.prewarmProfileSource !== false,
    bundledProfilesPath: config.bundledProfilesPath !== undefined
      ? config.bundledProfilesPath
      : process.env.RECORDS_BUNDLED_PROFILES_PATH,
  };
}

function resolvePositiveInteger(
  configured: number | undefined,
  raw: string | undefined,
  fallback: number,
): number {
  const value = configured ?? (raw?.trim() ? Number(raw) : fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
