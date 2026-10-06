import type { AutoDownloadSourceContext } from './sd-loader-auto-download-source-context.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { sanitizeProfile } from './sd-loader-profile-sanitizer.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { cacheKeyForProfile } from './sd-loader-version-utils.js';

/** Sanitize and commit a remotely resolved profile to all canonical cache keys. */
export function cacheDownloadedProfile(
  url: string,
  profile: StructureDefinition,
  context: AutoDownloadSourceContext,
): StructureDefinition | null {
  const family = context.fhirVersion || 'R4';
  if (!profileMatchesCanonical(profile, url, family)) return null;
  const sanitized = sanitizeProfile(profile);
  if (context.canCache && !context.canCache()) return sanitized;
  const canonicals = new Set([
    url,
    sanitized.url,
    ...(sanitized.version ? [`${sanitized.url}|${sanitized.version}`] : []),
  ]);
  for (const canonical of canonicals) {
    context.cache.set(cacheKeyForProfile(canonical, family), sanitized);
    context.availableProfiles.add(canonical);
  }
  return sanitized;
}
