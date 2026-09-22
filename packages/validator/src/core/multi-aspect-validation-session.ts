import type { ProfileApplicationSource, ValidationSettings } from '@records-fhir/validation-types';
import { ReferenceTargetValidator } from '../validators/reference-target-validator.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import { BatchValidationAbortedError } from './batch-validator.js';
import { appendBundleEntryValidationResults } from './multi-aspect-bundle-entry-validation.js';
import { appendContainedResourceValidationResults } from './multi-aspect-contained-validation.js';
import { appendMandatedProfileValidationResults } from './multi-aspect-mandated-profile.js';
import { appendParametersResourceValidationResults } from './multi-aspect-parameters-validation.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import { executeSelectedAspects } from './multi-aspect-aspect-execution.js';
import {
  MultiAspectResourcePreparation,
} from './multi-aspect-resource-preparation.js';
import type { AspectResult, MultiAspectValidateResult, ValidateOneFn } from './multi-aspect-types.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { SDFHIRPathExecutor } from '../validators/sd-fhirpath-executor.js';
import { MultiAspectSessionPolicy } from './multi-aspect-session-policy.js';
import { createAspectIssueAttribution } from './multi-aspect-profile-attribution.js';
import { projectSemanticAspectResult, resolveSemanticAspectPlan, type SemanticAspectPlan } from './semantic-aspect-plan.js';
import { createReferenceResourceFetcher } from '../reference/reference-resource-fetcher.js';

const EMBEDDED_RESOURCE_MAX_DEPTH = 3;

interface MultiAspectValidationSessionOptions {
  deps: MultiAspectDeps;
  aspects: string[];
  settings: unknown;
  organizationId?: number;
  shouldStop?: () => boolean;
  onEmbeddedResourceValidated?: (
    resource: Record<string, unknown>,
    result: MultiAspectValidateResult,
  ) => void | Promise<void>;
  externalReferenceResolver?: ReferenceResolver;
  serverId?: number;
  profileSources?: ReadonlyMap<unknown, ProfileApplicationSource>;
}

export class MultiAspectValidationSession {
  private readonly typedSettings: ValidationSettings | undefined;
  private readonly aspectPlan: SemanticAspectPlan;
  private readonly policy: MultiAspectSessionPolicy;
  private readonly targetProfileValidator = new ReferenceTargetValidator();
  private readonly sdFHIRPathExecutor: SDFHIRPathExecutor;
  private readonly resourcePreparation: MultiAspectResourcePreparation;
  private readonly referenceResourceFetcher;

  constructor(private readonly options: MultiAspectValidationSessionOptions) {
    this.typedSettings = options.settings as ValidationSettings | undefined;
    this.aspectPlan = resolveSemanticAspectPlan(options.aspects);
    this.policy = new MultiAspectSessionPolicy(this.typedSettings);
    this.sdFHIRPathExecutor = options.deps.sdFHIRPathExecutor ?? new SDFHIRPathExecutor();
    this.referenceResourceFetcher = createReferenceResourceFetcher(options.deps.fhirClient);
    this.resourcePreparation = new MultiAspectResourcePreparation({
      deps: options.deps,
      settings: options.settings,
      organizationId: options.organizationId,
      serverId: options.serverId,
      externalReferenceResolver: options.externalReferenceResolver,
      referenceResourceFetcher: this.referenceResourceFetcher,
      throwIfStopped: () => this.throwIfStopped(),
    });
  }

  validate = async (
    resource: unknown,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<MultiAspectValidateResult> => projectSemanticAspectResult(
    await this.validateOne(resource, profileUrl, fhirVersion, 0), this.aspectPlan,
  );

  private validateOne: ValidateOneFn = async (
    resource,
    profileUrl,
    fhirVersion,
    recursionDepth,
    enclosingBundle,
    skipTargetProfileConformance,
    containingResource,
  ) => {
    this.throwIfStopped();
    const prepared = await this.resourcePreparation.prepare(
      resource,
      profileUrl,
      fhirVersion,
      enclosingBundle,
      containingResource,
    );
    if (prepared.kind === 'missing-profile') return prepared.result;

    const { context, profileFallbackIssue, profileSourceContext } = prepared;
    const collectedAspects: AspectResult[] = [];
    const runAspect = this.policy.createRunner({
      collectedAspects,
      fhirVersion,
      profileUrl,
      attributeIssues: createAspectIssueAttribution(
        context, profileFallbackIssue, this.options.profileSources?.get(resource),
      ),
      throwIfStopped: () => this.throwIfStopped(),
    });

    await executeSelectedAspects({
      deps: this.options.deps,
      selectedAspects: this.aspectPlan.executors,
      settings: this.typedSettings,
      organizationId: this.options.organizationId,
      profileSourceContext,
      profileFallbackIssue,
      runCustomRules: this.policy.runCustomRules,
      context,
      collectedAspects,
      runAspect,
      validateOne: this.validateOne,
      targetProfileValidator: this.targetProfileValidator,
      recursionDepth,
      skipTargetProfileConformance,
      containingResource,
      throwIfStopped: () => this.throwIfStopped(),
      sdFHIRPathExecutor: this.sdFHIRPathExecutor,
      referenceResourceFetcher: this.referenceResourceFetcher,
    });
    await this.appendEmbeddedValidation(
      context.resource,
      fhirVersion,
      recursionDepth,
      enclosingBundle,
      context.structureDef,
      collectedAspects,
    );
    if (recursionDepth < EMBEDDED_RESOURCE_MAX_DEPTH) {
      await appendMandatedProfileValidationResults(
        context.resource,
        context.profileUrl,
        fhirVersion,
        recursionDepth,
        this.validateOne,
        collectedAspects,
        enclosingBundle,
        this.options.shouldStop,
        containingResource,
      );
    }
    return this.policy.buildResult(collectedAspects, context.structureDef, profileFallbackIssue);
  };

  private async appendEmbeddedValidation(
    resource: Record<string, unknown>,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
    enclosingBundle: Record<string, unknown> | undefined,
    structureDef: StructureDefinition,
    collectedAspects: AspectResult[],
  ): Promise<void> {
    if (Array.isArray(resource.contained) && recursionDepth < EMBEDDED_RESOURCE_MAX_DEPTH) {
      await appendContainedResourceValidationResults(
        resource,
        fhirVersion,
        recursionDepth,
        this.validateOne,
        collectedAspects,
        enclosingBundle,
        this.options.shouldStop,
      );
      this.throwIfStopped();
    }
    if (resource.resourceType === 'Parameters' && recursionDepth < EMBEDDED_RESOURCE_MAX_DEPTH) {
      await appendParametersResourceValidationResults(
        resource,
        fhirVersion,
        recursionDepth,
        this.validateOne,
        collectedAspects,
        enclosingBundle,
        this.options.shouldStop,
      );
      this.throwIfStopped();
    }
    if (
      !this.policy.validateBundleEntries
      || resource.resourceType !== 'Bundle'
      || recursionDepth >= EMBEDDED_RESOURCE_MAX_DEPTH
    ) return;

    await appendBundleEntryValidationResults(
      resource,
      fhirVersion,
      recursionDepth,
      this.validateOne,
      collectedAspects,
      structureDef,
      issues => this.policy.applyProfileIssuePolicies(issues),
      this.options.shouldStop,
      this.options.onEmbeddedResourceValidated && ((child, result) =>
        this.options.onEmbeddedResourceValidated!(child, projectSemanticAspectResult(result, this.aspectPlan))),
    );
    this.throwIfStopped();
  }

  private throwIfStopped(): void {
    if (this.options.shouldStop?.()) throw new BatchValidationAbortedError();
  }
}
