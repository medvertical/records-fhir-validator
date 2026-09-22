import type { ProfileCache } from '../cache/profile-cache.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { getIncompatibleProfileResourceType } from './profile-resource-type.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { createValidationWarningIssue } from './validation-utils.js';
import { suggestProfilesForUnresolvedCanonical } from './profile-canonical-suggestions.js';
import { loadProfileForValidation, type FhirClientLike } from './profile-snapshot-loading.js';

export type { FhirClientLike } from './profile-snapshot-loading.js';
export { loadProfileForValidation, loadProfileWithSnapshot } from './profile-snapshot-loading.js';
export { suggestProfilesForUnresolvedCanonical } from './profile-canonical-suggestions.js';
export { createProfileResourceTypeMismatchIssue } from './profile-resource-type.js';

export interface ProfileLoadResult {
  structureDef: StructureDefinition | null;
  declaredProfileUrl: string;
  usedBaseFallback: boolean;
  incompatibleProfileType?: string;
}

export async function loadProfileOrBase(
  sdLoader: StructureDefinitionLoader,
  snapshotGenerator: SnapshotGenerator,
  declaredProfileUrl: string,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  profileCache?: ProfileCache,
  fhirClient?: FhirClientLike,
  resolutionContext?: ProfileSourceContext,
  settings?: ValidationSettings,
): Promise<ProfileLoadResult> {
  const load = (url: string) => loadProfileForValidation(
    sdLoader,
    snapshotGenerator,
    url,
    fhirVersion,
    profileCache,
    fhirClient,
    resolutionContext,
    settings,
  );
  const declared = await load(declaredProfileUrl);
  if (declared) {
    const incompatibleProfileType = getIncompatibleProfileResourceType(declared, resourceType);
    if (!incompatibleProfileType) {
      return { structureDef: declared, declaredProfileUrl, usedBaseFallback: false };
    }
    const base = declaredProfileUrl === baseProfileUrl(resourceType)
      ? null
      : await load(baseProfileUrl(resourceType));
    return {
      structureDef: base,
      declaredProfileUrl,
      usedBaseFallback: base !== null,
      incompatibleProfileType,
    };
  }
  if (declaredProfileUrl === baseProfileUrl(resourceType)) {
    return { structureDef: null, declaredProfileUrl, usedBaseFallback: false };
  }
  const base = await load(baseProfileUrl(resourceType));
  return { structureDef: base, declaredProfileUrl, usedBaseFallback: base !== null };
}

export function createProfileFallbackIssue(
  profileUrl: string,
  resourceType: string,
  profileSource?: Pick<StructureDefinitionLoader, 'getAvailableProfiles'>,
): ValidationIssue {
  const baseProfile = baseProfileUrl(resourceType);
  const suggestedProfiles = suggestProfilesForUnresolvedCanonical(
    profileUrl,
    profileSource?.getAvailableProfiles?.() ?? [],
  );
  const details: Record<string, unknown> = {
    profile: profileUrl,
    resourceType,
    baseProfile,
    validatedAgainstBase: true,
    profileResolutionStatus: 'unresolved',
    profileApplicationStatus: 'not-applied',
    validationComplete: false,
    ...(suggestedProfiles.length > 0 ? { suggestedProfiles } : {}),
  };
  return {
    ...createValidationWarningIssue(
      'profile',
      'profile-not-resolved',
      `Profile ${profileUrl} could not be resolved; validated against base ${resourceType} instead`,
      details,
      'meta.profile',
    ),
    profile: profileUrl,
  };
}

function baseProfileUrl(resourceType: string): string {
  return `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
}
