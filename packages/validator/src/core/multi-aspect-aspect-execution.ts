import type { ProfileSourceContext } from '../persistence/index.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { validateBestPractices } from '../validators/best-practice-validator.js';
import type { ReferenceTargetValidator } from '../validators/reference-target-validator.js';
import type { SDFHIRPathExecutor } from '../validators/sd-fhirpath-executor.js';
import { validateReferenceTargetProfileConformance } from './multi-aspect-target-profile-conformance.js';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import type { MultiAspectResourceContext } from './multi-aspect-resource-preparation.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';
import type { createMultiAspectRunner } from './multi-aspect-runner.js';
import { getValueAtPath } from './validation-utils.js';
import type { ReferenceResourceFetcher } from '../reference/reference-fetch-deadline.js';

interface ExecuteSelectedAspectsOptions {
  deps: MultiAspectDeps;
  selectedAspects: ReadonlySet<string>;
  settings?: ValidationSettings;
  organizationId?: number;
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
  const { context: ctx, deps, selectedAspects, runAspect } = options;
  deps.terminologyExecutor?.setSourceContext?.(options.profileSourceContext);
  if (selectedAspects.has('structural')) {
    await runAspect('structural', async () => [
      ...await deps.structuralExecutor.validate(ctx.resource, { ...ctx, getValueAtPath }),
      ...validateBestPractices(deps.bestPracticeValidator, {
        resource: ctx.resource,
        resourceType: ctx.resourceType,
        profileUrl: ctx.profileUrl,
      }, options.settings),
    ]);
  }

  const needsInvariantContext = selectedAspects.has('invariant');
  const preInvariantAspects: Promise<void>[] = [];
  const parallelAspects: Promise<void>[] = [];
  const schedule = (promise: Promise<void>, contributesToInvariantContext = false) => {
    (needsInvariantContext && contributesToInvariantContext ? preInvariantAspects : parallelAspects).push(promise);
  };

  if (selectedAspects.has('profile')) {
    schedule(runAspect('profile', async () => {
      const profileIssues = await deps.profileExecutor.validate({
        ...ctx,
        getValueAtPath,
        sdFHIRPathExecutor: options.sdFHIRPathExecutor,
        terminologyResolver: deps.terminologyExecutor.getFHIRPathTerminologyResolver?.(),
      });
      return [
        ...(options.profileFallbackIssue ? [options.profileFallbackIssue] : []),
        ...profileIssues,
      ];
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
      ...deps.terminologyResourceValidator.validate(ctx.resource, ctx.fhirVersion),
    ]), true);
  }

  try {
    if (preInvariantAspects.length > 0) {
      await Promise.all(preInvariantAspects);
      options.throwIfStopped();
    }
    scheduleParallelAspects(options, parallelAspects);
    if (parallelAspects.length > 0) {
      await Promise.all(parallelAspects);
      options.throwIfStopped();
    }
  } finally {
    // A cancellation rejects one runner while its admitted siblings may still own I/O.
    await Promise.allSettled([...preInvariantAspects, ...parallelAspects]);
  }
}

function scheduleParallelAspects(
  options: ExecuteSelectedAspectsOptions,
  parallelAspects: Promise<void>[],
): void {
  const { context: ctx, deps, selectedAspects, runAspect } = options;
  if (selectedAspects.has('reference')) {
    parallelAspects.push(runAspect('reference', async () => {
      const referenceIssues = await deps.referenceExecutor.validate({
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
      const wantsTargetProfiles = !options.skipTargetProfileConformance
        && options.settings?.recursiveReferenceValidation?.validateTargetProfiles === true
        && Boolean(ctx.referenceResolver);
      if (!wantsTargetProfiles) return referenceIssues;

      const conformanceIssues = await validateReferenceTargetProfileConformance({
        resource: ctx.resource,
        structureDef: ctx.structureDef,
        referenceTargetValidator: options.targetProfileValidator,
        resolveReference: ctx.referenceResolver ?? undefined,
        validateProfile: async (target, profile) => {
          const result = await options.validateOne(
            target,
            profile,
            ctx.fhirVersion,
            options.recursionDepth + 1,
            ctx.enclosingBundle,
            true,
            options.containingResource ?? ctx.resource,
          );
          return result.aspects.flatMap(aspect => aspect.issues);
        },
      });
      return [...referenceIssues, ...conformanceIssues];
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
    }) : []));
  }
  if (selectedAspects.has('metadata')) {
    parallelAspects.push(runAspect(
      'metadata',
      () => deps.metadataExecutor.validate({ resource: ctx.resource }, ctx.profileUrl),
    ));
  }
}
