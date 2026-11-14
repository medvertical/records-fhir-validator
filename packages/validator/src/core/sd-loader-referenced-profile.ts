import type { ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { withProfileSourceSnapshot } from '../persistence/profile-source.js';
import { copyProfilePackageProvenance, lookupProfilePackageDirectory, lookupProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { isPinExemptCanonical } from '../package/canonical-pin-context.js';
import { captureValidationDependency } from '../validation-dependency-snapshot.js';
import { profileDefinitionSourceKey, ProfileReferenceUnavailableError, resolveProfileReferenceAuthority, rethrowProfileReferenceCaptureFailure, profileReferenceHasPackageAuthority, type ProfileReferenceSource } from './profile-reference-authority.js';
import type { StructureDefinitionLoaderRuntime } from './sd-loader-runtime.js';
import type { ProfileVersionAliases } from './profile-version-aliases.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { isTenantScopedProfileRequest } from './tenant-profile-source-resolution.js';
import { checkSnapshotProfile, withSnapshotProfileLookup } from './snapshot-profile-checks.js';

/** Keeps dependency closure selection, provenance, and snapshot capture under one authority. */
export function loadPackageReferencedProfile(
  runtime: StructureDefinitionLoaderRuntime, versionAliases: ProfileVersionAliases,
  url: string, source: ProfileReferenceSource | null | undefined, fhirVersion: 'R4' | 'R5' | 'R6',
  context?: ProfileSourceContext, settings?: ValidationSettings,
): Promise<StructureDefinition | null> {
  const originalUrl = url;
  const pins = runtime.policy.getPackageVersionPins();
  url = isTenantScopedProfileRequest(url, context) ? url
    : versionAliases.resolve(url, fhirVersion, runtime.policy.packagePins);
  const captureScope = runtime.getDependencyCaptureScope();
  // Reference authority depends on issued package provenance and identity, not the referrer's full definition.
  const copiedSource = source && { url: source.url, version: source.version };
  copyProfilePackageProvenance(source, copiedSource);
  const scope = { storeDirs: [...runtime.packageSources], packageVersionPins: runtime.policy.getPackageVersionPins(),
    dependencyAliases: runtime.profileDependencyAliases };
  const inventoryEligible = !isTenantScopedProfileRequest(url, context) && profileReferenceHasPackageAuthority(url, copiedSource);
  return withSnapshotProfileLookup(url, context, copiedSource ?? undefined, () => captureValidationDependency('profile', 'load-referenced-profile',
    [url, fhirVersion, context, settings, copiedSource, copiedSource && lookupProfilePackageProvenance(copiedSource),
      copiedSource && lookupProfilePackageDirectory(copiedSource)], () => {
      // Capture policy synchronously on a real lookup, before its first await; dependency hits need no fallback copy.
      const fallback = runtime.captureProfileResolver(context, settings, {
        refreshHostProfile: !isPinExemptCanonical(url.split('|')[0]), retainUnavailableFailures: true,
      });
      return withProfileSourceSnapshot(async () => {
        const authority = isTenantScopedProfileRequest(url, context)
          ? { status: 'unscoped' as const } : await resolveProfileReferenceAuthority(url, copiedSource, scope, fhirVersion,
            { reuseScope: captureScope, currentScope: () => runtime.getDependencyCaptureScope() });
        if (authority.status === 'unavailable') throw new ProfileReferenceUnavailableError(authority.receipt);
        if (authority.status === 'selected') {
          if (captureScope === runtime.getDependencyCaptureScope()) {
            const profile = structuredClone(authority.profile); copyProfilePackageProvenance(authority.profile, profile);
            runtime.cache.set(`${profile.url}|${profile.version ?? 'unversioned'}:${fhirVersion}@${profileDefinitionSourceKey(profile)}`, profile);
            runtime.pruneProfileCache();
          }
          return authority.profile;
        }
        if (originalUrl !== url && authority.status === 'exhausted') return null;
        return fallback(url, fhirVersion);
      });
     }, captureScope, () => runtime.getDependencyCaptureScope(), inventoryEligible)
    .catch(async error => {
      await checkSnapshotProfile(url, null, context, copiedSource ?? undefined);
      return rethrowProfileReferenceCaptureFailure(error, url, copiedSource);
    })).then(profile => originalUrl === url ? profile
      : profile && versionAliases.accepts(profile, originalUrl, fhirVersion, pins) ? profile : null);
}
