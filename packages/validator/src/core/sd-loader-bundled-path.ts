import { createRequire } from 'module';
import * as path from 'path';
import { logger } from '../logger';

export function resolveDefaultBundledProfilesPath(): string | null {
  const fromEnv =
    process.env.FHIR_BUNDLED_PROFILES_PATH ?? process.env.RECORDS_BUNDLED_PROFILES_PATH;
  if (fromEnv) {
    if (process.env.RECORDS_BUNDLED_PROFILES_PATH && !process.env.FHIR_BUNDLED_PROFILES_PATH) {
      logger.warn(
        '[SDLoader] RECORDS_BUNDLED_PROFILES_PATH is deprecated; rename to FHIR_BUNDLED_PROFILES_PATH (will be removed in 0.2.x).',
      );
    }
    return fromEnv;
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgEntry = require.resolve('@records-fhir/bundled-profiles');
    return path.resolve(path.dirname(pkgEntry), 'storage', 'profiles', 'bundled');
  } catch {
    return null;
  }
}
