import { ProfileReferenceUnavailableError } from './profile-reference-authority.js';
import type { ProfileCache } from '../cache/profile-cache.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../persistence/index.js';
import { getIncompatibleProfileResourceType, isUsableResourceBaseProfile } from './profile-resource-type.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { createValidationWarningIssue } from './validation-utils.js';
import { suggestProfilesForUnresolvedCanonical } from './profile-canonical-suggestions.js';
import { loadProfileForValidation, type FhirClientLike } from './profile-snapshot-loading.js';
import { createProfileUnreadable } from '../issues/profile-completeness-issues.js';

export type { FhirClientLike } from './profile-snapshot-loading.js';
export { loadProfileForValidation, loadProfileWithSnapshot } from './profile-snapshot-loading.js';
export { suggestProfilesForUnresolvedCanonical } from './profile-canonical-suggestions.js';
export { createProfileResourceTypeMismatchIssue } from './profile-resource-type.js';

export interface ProfileLoadResult {
  structureDef: StructureDefinition | null;
  declaredProfileUrl: string;
  usedBaseFallback: boolean;
  incompatibleProfileType?: string;
  baseLoadIssue?: ValidationIssue;
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
  let declared: StructureDefinition | null;
  let dependencyIssue: ValidationIssue | undefined;
  try { declared = await load(declaredProfileUrl); }
  catch (error: unknown) {
    if (!(error instanceof ProfileReferenceUnavailableError)) throw error;
    declared = null;
    dependencyIssue = { aspect: 'profile', severity: 'information', code: 'profile-reference-unavailable',
      message: 'A required profile dependency could not be verified; the requested profile was not fully checked.',
      path: 'meta.profile', profile: declaredProfileUrl,
      details: { validationComplete: false, validationStatus: 'incomplete', ...error.receipt } };
  }
  if (declared) {
    const incompatibleProfileType = getIncompatibleProfileResourceType(declared, resourceType, fhirVersion);
    if (!incompatibleProfileType) {
      return { structureDef: declared, declaredProfileUrl, usedBaseFallback: false };
    }
    let candidate: StructureDefinition | null = null;
    let baseLoadIssue: ValidationIssue | undefined;
    if (declaredProfileUrl !== baseProfileUrl(resourceType)) {
      try {
        candidate = await load(baseProfileUrl(resourceType));
      } catch (error: unknown) {
        baseLoadIssue = createProfileUnreadable({ profileUrl: baseProfileUrl(resourceType), resourceType,
          reason: 'structural-profile', error });
      }
    }
    const base = isUsableResourceBaseProfile(candidate, resourceType, fhirVersion) ? candidate : null;
    return {
      structureDef: base,
      declaredProfileUrl,
      usedBaseFallback: base !== null,
      incompatibleProfileType,
      ...(baseLoadIssue ? { baseLoadIssue } : {}),
    };
  }
  if (declaredProfileUrl === baseProfileUrl(resourceType)) {
    return { structureDef: null, declaredProfileUrl, usedBaseFallback: false, ...(dependencyIssue ? { baseLoadIssue: dependencyIssue } : {}) };
  }
  const base = await load(baseProfileUrl(resourceType));
  return { structureDef: base, declaredProfileUrl, usedBaseFallback: base !== null, ...(dependencyIssue ? { baseLoadIssue: dependencyIssue } : {}) };
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
