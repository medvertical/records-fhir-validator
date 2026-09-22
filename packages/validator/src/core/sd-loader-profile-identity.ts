import type { StructureDefinition } from './structure-definition-types.js';
import { normalizeKnownStructureDefinitionCanonicalUrl } from './sd-loader-version-utils.js';

export function profileMatchesCanonical(
  profile: StructureDefinition,
  requestedUrl: string,
): boolean {
  if (profile.resourceType !== 'StructureDefinition') return false;
  const [canonical, requestedVersion] = requestedUrl.split('|');
  if (
    normalizeKnownStructureDefinitionCanonicalUrl(profile.url)
    !== normalizeKnownStructureDefinitionCanonicalUrl(canonical)
  ) {
    return false;
  }
  if (!requestedVersion) return true;
  if (!profile.version) return false;
  return normalizeCanonicalVersion(profile.version) === normalizeCanonicalVersion(requestedVersion);
}

function normalizeCanonicalVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.0` : version;
}
