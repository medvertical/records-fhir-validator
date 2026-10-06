/**
 * Resolve canonicals referenced from inside a profile — its base definition,
 * slice type profiles, extension definitions and reference target profiles —
 * at the releases the profile's own package depends on, as the HL7 reference
 * validator does. Without it an unversioned reference resolves to the newest
 * installed release: ISiP 1.0.2 derives from ISiK Basismodul 2.0.x, which
 * depends on de.basisprofil.r4 1.4.0, yet its identifier-kvid-10 slice took
 * Basisprofil 1.5.4, whose Identifier.type pattern (KVZ10) contradicts the
 * slice's own (GKV).
 *
 * The profile's package is the one the loader read it from; a profile served
 * by a host source or a remote download carries no such provenance and its
 * references resolve as before.
 */
import { ProfileReferenceUnavailableError, resolveProfileReferenceAuthority } from './profile-reference-authority.js';
import type { ProfileReferenceCaptureOwner } from './profile-reference-package-inventory.js';
import type { ProfileReferenceSource, ProfileReferencePinScope } from './profile-reference-authority.js';
export type { ProfileReferenceSource, ProfileReferencePinScope } from './profile-reference-authority.js';

/**
 * `canonicalUrl` versioned to the release the referencing profile's package
 * closure ships, or unchanged when the profile has no package provenance or
 * no package of its closure ships the canonical.
 */
export async function pinProfileReference(
  canonicalUrl: string,
  source: ProfileReferenceSource | null | undefined,
  scope: ProfileReferencePinScope,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  owner?: ProfileReferenceCaptureOwner,
): Promise<string> {
  const result = await resolveProfileReferenceAuthority(canonicalUrl, source, scope, fhirVersion ?? 'R4', owner);
  if (result.status === 'unavailable') throw new ProfileReferenceUnavailableError(result.receipt);
  return result.status === 'selected' && result.profile.version && !canonicalUrl.includes('|')
    ? `${canonicalUrl}|${result.profile.version}` : canonicalUrl;
}
