import {
  getProfileSource,
  type ProfileSourceContext,
} from '../persistence/index.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import type { StructureDefinition } from './structure-definition-types.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

export function isTenantScopedProfileRequest(
  profileUrl: string,
  context: ProfileSourceContext | undefined,
): context is ProfileSourceContext & { organizationId: number } {
  return context?.organizationId !== undefined
    && !profileUrl.split('|')[0].startsWith('http://hl7.org/fhir/StructureDefinition/');
}

/**
 * Resolve a canonical-exact tenant profile through the host-provided source.
 * Callers retain their existing FHIR-release and failure-handling policies.
 */
export async function resolveTenantProfileFromSource(
  profileUrl: string,
  fhirVersion: FhirVersion,
  context: ProfileSourceContext,
  settings?: ValidationSettings,
): Promise<StructureDefinition | null> {
  if (!isTenantScopedProfileRequest(profileUrl, context)) return null;

  const source = getProfileSource();
  if (!source.resolveProfile) return null;

  const [canonicalUrl, explicitVersion] = profileUrl.split('|');
  const profile = await source.resolveProfile(
    canonicalUrl,
    explicitVersion || undefined,
    settings,
    { ...context, fhirVersion },
  );
  return profile && profileMatchesCanonical(profile, profileUrl)
    ? profile
    : null;
}
