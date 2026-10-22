import { recordPatientNarrativeOrigins } from './patient-narrative-issue-reconciliation.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { validateBestPractices } from '../validators/best-practice-validator.js';
import { loadConceptMapCodeSystems } from '../validators/conceptmap-resource-validator.js';
import type { ReferenceTargetValidator } from '../validators/reference-target-validator.js';
import type { SDFHIRPathExecutor } from '../validators/sd-fhirpath-executor.js';
import { loadExtensionTargetDefinition, targetProfileResolver, validateReferenceTargetProfileConformance } from './multi-aspect-target-profile-conformance.js';
import { createProfileConformanceCheck } from './multi-aspect-profile-conformance.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import type { MultiAspectResourceContext } from './multi-aspect-resource-preparation.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';
import type { createMultiAspectRunner } from './multi-aspect-runner.js';
import { getValueAtPath } from './validation-utils.js';
import type { ReferenceResourceFetcher } from '../reference/reference-fetch-deadline.js';
import { validateValueSetIncludeSystemOids } from '../validators/valueset-include-oid-rule.js';
import type { CustomRuleSelectedRelease } from '../custom-rules/applicability.js';

interface ExecuteSelectedAspectsOptions {
  deps: MultiAspectDeps;
  selectedAspects: ReadonlySet<string>;
  settings?: ValidationSettings;
  organizationId?: number;
  selectedRelease?: CustomRuleSelectedRelease | null;
  profileSourceContext: ProfileSourceContext;
  profileFallbackIssue: ValidationIssue | null;
  runCustomRules: boolean;
  context: MultiAspectResourceContext;
  collectedAspects: AspectResult[];
  runAspect: ReturnType<typeof createMultiAspectRunner>;
  validateOne: ValidateOneFn;
  targetProfileValidator: ReferenceTargetValidator;
  recursionDepth: number;
  skipTargetProfileConformance?: boolean;
  containingResource?: Record<string, unknown>;
  throwIfStopped: () => void;
  sdFHIRPathExecutor: SDFHIRPathExecutor;
  referenceResourceFetcher?: ReferenceResourceFetcher;
}

export async function executeSelectedAspects(options: ExecuteSelectedAspectsOptions): Promise<void> {
  const run = () => executeSelectedAspectsScoped(options);
  const executor = options.deps.terminologyExecutor;
  await (executor?.withSourceContext?.(options.profileSourceContext, run) ?? run());
}

async function executeSelectedAspectsScoped(options: ExecuteSelectedAspectsOptions): Promise<void> {
  const { context: ctx, deps, selectedAspects, runAspect } = options;
  deps.terminologyExecutor?.setSourceContext?.(options.profileSourceContext);
  if (selectedAspects.has('structural')) {
    await runAspect('structural', async () => {
      const structuralIssues = await deps.structuralExecutor.validate(ctx.resource, { ...ctx, getValueAtPath });
      const bestPracticeIssues = validateBestPractices(deps.bestPracticeValidator, {
        resource: ctx.resource,
        resourceType: ctx.resourceType,
        profileUrl: ctx.profileUrl,
      }, options.settings);
      return recordPatientNarrativeOrigins([...structuralIssues, ...bestPracticeIssues], { generated: bestPracticeIssues });
    });
  }

  const needsInvariantContext = selectedAspects.has('invariant');
  const preInvariantAspects: Promise<void>[] = [];
  const parallelAspects: Promise<void>[] = [];
  const schedule = (promise: Promise<void>, contributesToInvariantContext = false) => {
    (needsInvariantContext && contributesToInvariantContext ? preInvariantAspects : parallelAspects).push(promise);
  };

  if (selectedAspects.has('profile')) {
    schedule(runAspect('profile', async () => {
      const incompleteIssues: ValidationIssue[] = [];
      const profileIssues = await deps.profileExecutor.validate({
        ...ctx,
        getValueAtPath,
        sdFHIRPathExecutor: options.sdFHIRPathExecutor,
        terminologyResolver: deps.terminologyExecutor.getFHIRPathTerminologyResolver?.(),
        profileConformance: createProfileConformanceCheck({
          sdLoader: deps.sdLoader,
          referencingProfile: ctx.structureDef,
          onIncomplete: issue => incompleteIssues.push(issue),
          validateOne: options.validateOne,
          fhirVersion: ctx.fhirVersion,
          recursionDepth: options.recursionDepth,
          enclosingBundle: ctx.enclosingBundle ?? (ctx.resourceType === 'Bundle' ? ctx.resource : undefined),
          containingResource: options.containingResource ?? ctx.resource,
        }),
      });
      return recordPatientNarrativeOrigins([
        ...(options.profileFallbackIssue ? [options.profileFallbackIssue] : []),
        ...profileIssues,
        ...incompleteIssues,
      ], { canonical: profileIssues });
    }), true);
  } else if (options.profileFallbackIssue) {
    schedule(runAspect('profile', async () => [options.profileFallbackIssue as ValidationIssue]));
  }

  if (selectedAspects.has('terminology')) {
    schedule(runAspect('terminology', async () => [
      ...await deps.terminologyExecutor.validate({
        resource: ctx.resource,
        resourceType: ctx.resourceType,
        structureDef: ctx.structureDef,
        getValueAtPath,
        fhirVersion: ctx.fhirVersion,
        sourceContext: options.profileSourceContext,
      }),
      ...deps.terminologyResourceValidator.validate(
        ctx.resource,
        ctx.fhirVersion,
        await loadConceptMapCodeSystems(ctx.resource, ctx.fhirVersion),
      ),
      ...await validateValueSetIncludeSystemOids(ctx.resource),
    ]), true);
  }

  // Reference reads can overlap the profile prerequisites without publishing
  // their issues before the invariant context is ready.
  const earlyReferenceIssues = preInvariantAspects.length > 0 && selectedAspects.has('reference')
    ? startEarlyReferenceIssues(options) : undefined;
  // The prerequisite phase may fail before the reference result is consumed.
  void earlyReferenceIssues?.catch(() => undefined);
  try {
    if (preInvariantAspects.length > 0) {
      await Promise.all(preInvariantAspects);
      options.throwIfStopped();
    }
    scheduleParallelAspects(options, parallelAspects, earlyReferenceIssues);
    if (parallelAspects.length > 0) {
      await Promise.all(parallelAspects);
      options.throwIfStopped();
    }
  } finally {
    // A cancellation rejects one runner while its admitted siblings may still own I/O.
    await Promise.allSettled([...preInvariantAspects, ...parallelAspects,
      ...(earlyReferenceIssues ? [earlyReferenceIssues] : [])]);
  }
}

function startEarlyReferenceIssues(options: ExecuteSelectedAspectsOptions): Promise<ValidationIssue[]> {
  try {
    return validateReferenceIssues(options);
  } catch (error) {
    return Promise.reject(error);
  }
}

function validateReferenceIssues(options: ExecuteSelectedAspectsOptions): Promise<ValidationIssue[]> {
  const { context: ctx, deps } = options;
  return deps.referenceExecutor.validate({
    fhirClient: deps.fhirClient,
    resource: ctx.resource,
    fhirVersion: ctx.fhirVersion,
    settings: options.settings,
    resourceFetcher: async (reference, fetchOptions) => {
      fetchOptions?.signal?.throwIfAborted();
      return ctx.referenceResolver?.(reference)
        ?? await options.referenceResourceFetcher?.(reference, fetchOptions)
        ?? null;
    },
  });
}

function scheduleParallelAspects(
  options: ExecuteSelectedAspectsOptions,
  parallelAspects: Promise<void>[],
  earlyReferenceIssues?: Promise<ValidationIssue[]>,
): void {
  const { context: ctx, deps, selectedAspects, runAspect } = options;
  if (selectedAspects.has('reference')) {
    parallelAspects.push(runAspect('reference', async () => {
      const referenceIssues = await (earlyReferenceIssues ?? validateReferenceIssues(options));
      if (options.skipTargetProfileConformance) return referenceIssues;

      const incompleteIssues: ValidationIssue[] = [];
      const conformanceIssues = await validateReferenceTargetProfileConformance({
        resource: ctx.resource,
        structureDef: ctx.structureDef,
        referenceTargetValidator: options.targetProfileValidator,
        resolveReference: targetProfileResolver(options.settings, {
          local: ctx.localReferenceResolver,
          all: ctx.referenceResolver,
        }),
        conformsTo: createProfileConformanceCheck({
          sdLoader: deps.sdLoader,
          referencingProfile: ctx.structureDef,
          onIncomplete: issue => incompleteIssues.push(issue),
          validateOne: options.validateOne,
          fhirVersion: ctx.fhirVersion,
          recursionDepth: options.recursionDepth,
          enclosingBundle: ctx.enclosingBundle ?? (ctx.resourceType === 'Bundle' ? ctx.resource : undefined),
          containingResource: options.containingResource ?? ctx.resource,
        }),
        onIncomplete: issue => incompleteIssues.push(issue),
        loadReferenceTargetDefinition: (url, source) => deps.sdLoader.loadReferencedProfile(url, source, ctx.fhirVersion),
        loadExtensionDefinition: (url, parent) => loadExtensionTargetDefinition(deps.sdLoader, deps.snapshotGenerator, url, parent ?? ctx.structureDef, ctx.fhirVersion),
        pinExtensionProfile: (url, definition) => deps.sdLoader.referencedProfileUrl(url, definition, ctx.fhirVersion),
      });
      return [...referenceIssues, ...conformanceIssues, ...incompleteIssues];
    }));
  }

  if (selectedAspects.has('invariant')) {
    parallelAspects.push(runAspect('invariant', () => deps.invariantExecutor.validate({
      resource: ctx.resource,
      structureDef: ctx.structureDef,
      profileUrl: ctx.profileUrl,
      existingIssues: options.collectedAspects.flatMap(aspect => aspect.issues),
    })));
  }

  if (selectedAspects.has('custom_rule')) {
    parallelAspects.push(runAspect('custom_rule', async () => options.runCustomRules ? deps.customRuleExecutor.validate({
      resource: ctx.resource,
      structureDef: ctx.structureDef,
      fhirVersion: ctx.fhirVersion,
      organizationId: options.organizationId,
      selectedRelease: options.selectedRelease,
      profileResolutionFallback: Boolean(options.profileFallbackIssue),
    }) : []));
  }
  if (selectedAspects.has('metadata')) {
    parallelAspects.push(runAspect(
      'metadata',
      () => deps.metadataExecutor.validate({ resource: ctx.resource }, ctx.profileUrl),
    ));
  }
}
