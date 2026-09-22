import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import { applyResourcePinToCanonical } from '../package/canonical-pin-context.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { matchCodeInferredProfile, type CodeInferredProfileMatch } from './code-inferred-profiles.js';
import { resolveContextQuestionnaire } from './context-questionnaire-resolution.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import type { FhirResource } from './fhir-resource.js';
import type { BundleCanonicalResolver } from './multi-aspect-bundle-reference-resolver.js';
import {
  createProfileFallbackIssue,
  createProfileResourceTypeMismatchIssue,
  loadProfileOrBase,
  type FhirClientLike,
} from './profile-loader-utils.js';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';

export type { FhirClientLike } from './profile-loader-utils.js';

export interface SingleResourceProfilePreparationInput {
  resource: FhirResource;
  explicitProfileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
  profileSourceContext: ProfileSourceContext;
  bundleCanonicalResolver?: BundleCanonicalResolver | null;
}

export interface SingleResourceProfilePreparationDependencies {
  sdLoader: StructureDefinitionLoader;
  profileCache?: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  questionnaireRegistry?: QuestionnaireContextRegistry;
}

export interface SingleResourceProfilePreparationResult {
  declaredProfileUrl: string;
  structureDef: StructureDefinition | null;
  profileFallbackIssue: ValidationIssue | null;
  /** Set when the profile was selected from Observation.code, not by the caller or resource. */
  codeInferredProfile: CodeInferredProfileMatch | null;
  contextQuestionnaire?: Record<string, unknown>;
}

export async function prepareSingleResourceProfile(
  input: SingleResourceProfilePreparationInput,
  dependencies: SingleResourceProfilePreparationDependencies,
): Promise<SingleResourceProfilePreparationResult> {
  const {
    resource,
    explicitProfileUrl,
    fhirVersion,
    settings,
    fhirClient,
    profileSourceContext,
    bundleCanonicalResolver,
  } = input;
  const {
    sdLoader,
    profileCache,
    snapshotGenerator,
    questionnaireRegistry,
  } = dependencies;

  sdLoader.setProfileResolutionContext(profileSourceContext, settings);
  const explicitOrDeclaredProfileUrl = explicitProfileUrl ?? getPrimaryDeclaredProfile(resource);
  const codeInferredProfile = explicitOrDeclaredProfileUrl
    ? null
    : matchCodeInferredProfile(resource);
  const declaredProfileUrl =
    explicitOrDeclaredProfileUrl
    ?? codeInferredProfile?.profileUrl
    ?? `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

  logger.debug('[RecordsValidator] Validating resource against profile', {
    resourceType: resource.resourceType,
    ...profileCanonicalMetadata(declaredProfileUrl),
  });

  // Resolution may be redirected to the version the resource's own IG pins;
  // reporting keeps the canonical exactly as the resource declared it.
  // Loader doubles without package sources simply resolve unpinned.
  const resolutionProfileUrl = await applyResourcePinToCanonical(
    sdLoader.getPackageSources?.() ?? [],
    resource,
    declaredProfileUrl,
    fhirVersion,
  );

  const loadResult = await loadProfileOrBase(
    sdLoader,
    snapshotGenerator,
    resolutionProfileUrl,
    resource.resourceType,
    fhirVersion,
    profileCache,
    fhirClient,
    profileSourceContext,
    settings,
  );
  if (!loadResult.structureDef) {
    return {
      declaredProfileUrl,
      structureDef: null,
      profileFallbackIssue: null,
      codeInferredProfile,
    };
  }

  const profileFallbackIssue = loadResult.incompatibleProfileType
    ? createProfileResourceTypeMismatchIssue(
      declaredProfileUrl,
      resource.resourceType,
      loadResult.incompatibleProfileType,
    )
    : loadResult.usedBaseFallback
      ? createProfileFallbackIssue(declaredProfileUrl, resource.resourceType, sdLoader)
      : null;
  const contextQuestionnaire = resource.resourceType === 'QuestionnaireResponse'
    ? await resolveContextQuestionnaire(
      resource,
      questionnaireRegistry,
      profileSourceContext,
      bundleCanonicalResolver,
    )
    : undefined;

  return {
    declaredProfileUrl,
    structureDef: loadResult.structureDef,
    profileFallbackIssue,
    // A fallback means validation ran against the base SD after all, so the
    // inferred profile must not claim the resulting findings.
    codeInferredProfile: profileFallbackIssue ? null : codeInferredProfile,
    contextQuestionnaire,
  };
}
