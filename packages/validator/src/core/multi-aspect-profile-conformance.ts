import { ProfileReferenceUnavailableError, profileDefinitionSourceKey, withSelectedProfileDefinition } from './profile-reference-authority.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { createSafeValidationFailureMessage, validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { createValidationErrorIssue, createValidationInfoIssue } from './core-validation-issue.js';
import type { StructureDefinition } from './structure-definition-types.js';
import type { ProfileConformanceCheck } from '../validators/sd-fhirpath-profile-conformance.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import type { ValidateOneFn } from './multi-aspect-types.js';
import { profileResourceTypeApplicability } from './profile-resource-type.js';
import { logger } from '../logger.js';

// Bundle entries are validated one level down already, and document chains
// run deep (eCR: Composition → Encounter → PractitionerRole → Practitioner).
const CONFORMANCE_MAX_DEPTH = 5;

interface ProfileConformanceScope {
  sdLoader: MultiAspectDeps['sdLoader'];
  referencingProfile?: StructureDefinition;
  onIncomplete?: (issue: ValidationIssue) => void;
  validateOne: ValidateOneFn;
  fhirVersion: 'R4' | 'R5' | 'R6';
  recursionDepth: number;
  enclosingBundle?: Record<string, unknown>;
  containingResource?: Record<string, unknown>;
}

/**
 * conformsTo() and a Reference's targetProfiles ask whether a resource is
 * valid against a profile, which the reference validator answers by
 * validating it, its own targets included: CH EPR requires its
 * DocumentReferences to conform to IHE MHD's profile without declaring it,
 * and a KBV Provenance fails its profile when the Condition it points at
 * fails its own. Only errors count against conformance. The depth bound
 * stops profiles and references that require each other. Each question
 * rechecks dynamic dependencies even if an earlier call was complete.
 */
export function createProfileConformanceCheck(scope: ProfileConformanceScope): ProfileConformanceCheck | undefined {
  if (scope.recursionDepth >= CONFORMANCE_MAX_DEPTH) {
    return async (_resource, profileUrl) => {
      scope.onIncomplete?.(createValidationInfoIssue(
        'profile', 'profile-conformance-incomplete',
        'Profile conformance validation stopped at the recursion limit.',
        { validationComplete: false, profile: profileUrl, causes: ['profile-conformance-depth-limit'] },
      ));
      return undefined;
    };
  }
  return async (resource, profileUrl, referencingProfile = scope.referencingProfile) => {
    let profile: StructureDefinition | null;
    const loadStartedAt = performance.now();
    try {
      if (referencingProfile && scope.sdLoader.loadReferencedProfile) {
        profile = await scope.sdLoader.loadReferencedProfile(profileUrl, referencingProfile, scope.fhirVersion);
      } else {
        profileUrl = referencingProfile
          ? await scope.sdLoader.referencedProfileUrl?.(profileUrl, referencingProfile, scope.fhirVersion) ?? profileUrl
          : profileUrl;
        profile = await scope.sdLoader.loadProfile(profileUrl, scope.fhirVersion);
      }
    } catch (error: unknown) {
      return reportProfileConformanceFailure(scope, profileUrl, error, 'profile-load-error');
    } finally {
      const durationMs = performance.now() - loadStartedAt;
      if (durationMs >= 500) logger.warn('[ProfileConformance] Slow dependency resolution', {
        ...profileCanonicalMetadata(profileUrl), durationMs, recursionDepth: scope.recursionDepth, fhirVersion: scope.fhirVersion,
      });
    }
    const sourceKey = profile ? profileDefinitionSourceKey(profile) : undefined;
    if (profile?.version && sourceKey) profileUrl = `${profile.url}|${profile.version}`;
    if (!profile) {
      scope.onIncomplete?.(createValidationInfoIssue(
        'profile', 'profile-conformance-incomplete',
        'The requested profile definition could not be loaded.',
        { validationComplete: false, profile: profileUrl, causes: ['profile-not-found'] },
      ));
      return undefined;
    }
    const applicable = profileResourceTypeApplicability(profile, resource.resourceType, scope.fhirVersion);
    if (applicable === false) return 'not-applicable';
    if (applicable === undefined) {
      scope.onIncomplete?.(createValidationInfoIssue(
        'profile', 'profile-conformance-incomplete',
        'The requested profile type applicability could not be established.',
        { validationComplete: false, profile: profileUrl, causes: ['profile-type-applicability-unverified'] },
      ));
      return undefined;
    }

    let result: Awaited<ReturnType<ValidateOneFn>>;
    try {
      result = await withSelectedProfileDefinition(profile, scope.fhirVersion, () => scope.validateOne(
        resource,
        profileUrl,
        scope.fhirVersion,
        scope.recursionDepth + 1,
        scope.enclosingBundle,
        false,
        scope.containingResource,
        true,
      ), sourceKey);
    } catch (error: unknown) {
      return reportProfileConformanceFailure(scope, profileUrl, error, 'profile-evaluation-error');
    }
    const incomplete = result.aspects.length === 0 || result.aspects.some(aspect => {
      const issues = aspect.evidenceIssues ?? aspect.issues;
      return (aspect.isValid === false && !issues.some(issue => ['error', 'fatal'].includes(issue.severity)))
        || issues.some(isIncompleteConformanceIssue);
    });
    if (incomplete) {
      for (const aspect of result.aspects) {
        for (const issue of aspect.evidenceIssues ?? aspect.issues) {
          if (issue.code === 'profile-reference-unavailable') scope.onIncomplete?.(issue);
        }
      }
      const operationalFailure = result.aspects.some(aspect =>
        (aspect.evidenceIssues ?? aspect.issues).some(issue =>
          ['internal-error', 'validation-error'].includes(issue.code ?? '')));
      const createIncompleteIssue = operationalFailure ? createValidationErrorIssue : createValidationInfoIssue;
      scope.onIncomplete?.(createIncompleteIssue(
        'profile', operationalFailure ? 'validation-error' : 'profile-conformance-incomplete',
        'Profile conformance validation could not be completed.',
        { validationComplete: false, profile: profileUrl,
          causes: [...new Set(result.aspects.flatMap(aspect =>
            (aspect.evidenceIssues ?? aspect.issues).map(issue => issue.code).filter(Boolean)))],
        },
      ));
      // An unavailable dependency cannot overturn an independently proved failure.
      return result.aspects.some(aspect => aspect.issues.some(issue =>
        ['error', 'fatal'].includes(issue.severity) && !isIncompleteConformanceIssue(issue)))
        ? false : undefined;
    }
    const conforms = !result.aspects.some(aspect =>
      aspect.issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal'));
    return conforms;
  };
}

function isIncompleteConformanceIssue(issue: ValidationIssue): boolean {
  return !isNonBlockingTerminology(issue) && (
    ['internal-error', 'validation-error', 'profile-not-found', 'profile-not-resolved'].includes(issue.code ?? '')
    || (typeof issue.details === 'object' && (issue.details?.validationComplete === false
      || issue.details?.validationStatus === 'incomplete')));
}

/** Preferred/example bindings cannot disprove conformance, even when their terminology is offline. */
function isNonBlockingTerminology(issue: ValidationIssue): boolean {
  return issue.code === 'terminology-binding-unverified'
    && !['error', 'fatal'].includes(issue.severity)
    && typeof issue.details === 'object'
    && ['preferred', 'example'].includes(String(issue.details?.strength));
}

function reportProfileConformanceFailure(
  scope: ProfileConformanceScope,
  profileUrl: string,
  error: unknown,
  cause: 'profile-pin-error' | 'profile-load-error' | 'profile-evaluation-error',
): undefined {
  if (error instanceof ProfileReferenceUnavailableError) {
    scope.onIncomplete?.(createValidationInfoIssue('profile', 'profile-reference-unavailable',
      error.message, { validationComplete: false, validationStatus: 'incomplete', ...error.receipt }));
    return undefined;
  }
  scope.onIncomplete?.(createValidationErrorIssue(
    'profile', 'validation-error', createSafeValidationFailureMessage('Profile conformance validation'),
    { validationComplete: false, causes: [cause],
      ...profileCanonicalMetadata(profileUrl), ...validationFailureMetadata(error) },
  ));
  return undefined;
}
