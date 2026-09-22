import { applyResourcePinToCanonical } from '../package/canonical-pin-context.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { ReferenceResourceFetcher } from '../reference/reference-fetch-deadline.js';
import {
  prefetchSliceReferenceTargets,
  sliceReferencePrefetchLimits,
} from '../reference/slice-reference-prefetch.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import { resolveContextQuestionnaire } from './context-questionnaire-resolution.js';
import { withIssuesSchemaVersion } from './issue-schema-version.js';
import {
  BundleReferenceIndexCache,
  createBundleCanonicalResolver,
  combineReferenceResolvers,
  createBundleReferenceResolver,
} from './multi-aspect-bundle-reference-resolver.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import type { MultiAspectValidateResult } from './multi-aspect-types.js';
import {
  createProfileFallbackIssue,
  createProfileResourceTypeMismatchIssue,
  loadProfileOrBase,
  type ProfileLoadResult,
} from './profile-loader-utils.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { createValidationErrorIssue } from './validation-utils.js';

type ResourcePreparationDeps = Pick<
  MultiAspectDeps,
  | 'fhirClient'
  | 'profileCache'
  | 'questionnaireRegistry'
  | 'sdLoader'
  | 'snapshotGenerator'
  | 'strictMode'
>;

interface MultiAspectResourcePreparationOptions {
  deps: ResourcePreparationDeps;
  settings: unknown;
  organizationId?: number;
  serverId?: number;
  externalReferenceResolver?: ReferenceResolver;
  referenceResourceFetcher?: ReferenceResourceFetcher;
  throwIfStopped?: () => void;
}

export interface MultiAspectResourceContext {
  resource: Record<string, unknown>;
  resourceType: string;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  settings: unknown;
  enclosingBundle?: Record<string, unknown>;
  contextQuestionnaire?: Record<string, unknown>;
  referenceResolver?: ReferenceResolver | null;
}

export type MultiAspectResourcePreparationResult =
  | {
    kind: 'ready';
    context: MultiAspectResourceContext;
    profileSourceContext: ProfileSourceContext;
    profileFallbackIssue: ValidationIssue | null;
  }
  | {
    kind: 'missing-profile';
    result: MultiAspectValidateResult;
  };

/**
 * Owns the stateful preparation required before aspect execution. Validation
 * sessions consume one prepared context instead of coordinating profile and
 * reference caches, fallback policy, and questionnaire lookup independently.
 */
export class MultiAspectResourcePreparation {
  private readonly typedSettings: ValidationSettings | undefined;
  private readonly profileLoadCache = new Map<string, Promise<ProfileLoadResult>>();
  private readonly bundleReferenceIndexCache = new BundleReferenceIndexCache();

  constructor(private readonly options: MultiAspectResourcePreparationOptions) {
    this.typedSettings = options.settings as ValidationSettings | undefined;
  }

  async prepare(
    resource: unknown,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    enclosingBundle?: Record<string, unknown>,
    containingResource?: Record<string, unknown>,
  ): Promise<MultiAspectResourcePreparationResult> {
    const resourceRecord = resource as Record<string, unknown>;
    const resourceType = resourceRecord.resourceType as string;
    // Resolution may be redirected to the version the resource's own IG pins;
    // the prepared context keeps the canonical exactly as declared. Loader
    // doubles without package sources simply resolve unpinned.
    const resolutionProfileUrl = await applyResourcePinToCanonical(
      this.options.deps.sdLoader.getPackageSources?.() ?? [],
      resourceRecord,
      profileUrl,
      fhirVersion,
    );
    const loadResult = await this.loadProfile(resolutionProfileUrl, resourceType, fhirVersion);
    this.options.throwIfStopped?.();
    if (!loadResult.structureDef) {
      return {
        kind: 'missing-profile',
        result: createMissingProfileResult(resourceRecord, profileUrl, fhirVersion),
      };
    }

    const profileSourceContext: ProfileSourceContext = {
      organizationId: this.options.organizationId,
      serverId: this.options.serverId,
      fhirVersion,
    };
    const contextQuestionnaire = resourceType === 'QuestionnaireResponse'
      ? await resolveContextQuestionnaire(
        resourceRecord,
        this.options.deps.questionnaireRegistry,
        profileSourceContext,
        createBundleCanonicalResolver(enclosingBundle, this.bundleReferenceIndexCache),
      )
      : undefined;
    const bundleReferenceResolver = createBundleReferenceResolver(
      enclosingBundle ?? (resourceType === 'Bundle' ? resourceRecord : undefined),
      containingResource ?? resourceRecord,
      this.bundleReferenceIndexCache,
    );

    return {
      kind: 'ready',
      profileSourceContext,
      profileFallbackIssue: this.createFallbackIssue(loadResult, profileUrl, resourceType),
      context: {
        resource: resourceRecord,
        resourceType,
        profileUrl,
        fhirVersion,
        structureDef: loadResult.structureDef,
        strictMode: this.options.deps.strictMode,
        settings: this.options.settings,
        enclosingBundle,
        contextQuestionnaire,
        referenceResolver: combineReferenceResolvers(
          combineReferenceResolvers(
            bundleReferenceResolver,
            await this.prefetchSliceReferences(resourceRecord, loadResult.structureDef, bundleReferenceResolver),
          ),
          this.options.externalReferenceResolver,
        ),
      },
    };
  }

  /**
   * Target-dependent slice discriminators are decided by the referenced
   * resource, so the synchronous matcher needs those payloads before it runs.
   */
  private async prefetchSliceReferences(
    resource: Record<string, unknown>,
    structureDef: StructureDefinition,
    bundleReferenceResolver: ReferenceResolver | null,
  ): Promise<ReferenceResolver | undefined> {
    const fetcher = this.options.referenceResourceFetcher;
    if (!fetcher) return undefined;
    const limits = sliceReferencePrefetchLimits(this.typedSettings?.recursiveReferenceValidation);
    if (!limits) return undefined;
    const resolver = await prefetchSliceReferenceTargets({
      resource,
      structureDef,
      fetcher,
      limits,
      alreadyResolved: bundleReferenceResolver,
    });
    this.options.throwIfStopped?.();
    return resolver ?? undefined;
  }

  private loadProfile(
    profileUrl: string,
    resourceType: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ProfileLoadResult> {
    const key = `${fhirVersion}|${profileUrl}|${resourceType}`;
    let promise = this.profileLoadCache.get(key);
    if (!promise) {
      const deps = this.options.deps;
      promise = loadProfileOrBase(
        deps.sdLoader,
        deps.snapshotGenerator,
        profileUrl,
        resourceType,
        fhirVersion,
        deps.profileCache,
        deps.fhirClient,
        {
          organizationId: this.options.organizationId,
          serverId: this.options.serverId,
          fhirVersion,
        },
        this.typedSettings,
      );
      this.profileLoadCache.set(key, promise);
    }
    return promise;
  }

  private createFallbackIssue(
    loadResult: ProfileLoadResult,
    profileUrl: string,
    resourceType: string,
  ): ValidationIssue | null {
    if (loadResult.incompatibleProfileType) {
      return createProfileResourceTypeMismatchIssue(
        profileUrl,
        resourceType,
        loadResult.incompatibleProfileType,
      );
    }
    return loadResult.usedBaseFallback
      ? createProfileFallbackIssue(profileUrl, resourceType, this.options.deps.sdLoader)
      : null;
  }
}

function createMissingProfileResult(
  resource: Record<string, unknown>,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): MultiAspectValidateResult {
  const issue = createValidationErrorIssue(
    'profile',
    'profile-not-found',
    `Profile ${profileUrl} not found and base StructureDefinition for ${resource.resourceType} could not be loaded`,
    { profile: profileUrl },
    'meta.profile',
  );
  return {
    isValid: false,
    aspects: [{
      aspect: 'profile',
      issues: withIssuesSchemaVersion([issue], fhirVersion),
      validationTime: 0,
      isValid: false,
    }],
  };
}
