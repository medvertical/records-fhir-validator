/* eslint-disable max-lines-per-function */
/**
 * Multi-Aspect Validate Callback
 *
 * Extracted from validator-engine.ts to keep that file within size limits.
 * Builds the per-resource validation callback used by executeBatchValidation
 * when multiple aspects are requested simultaneously.
 */

import type { ValidationIssue, ValidationSettings } from '../types';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { SnapshotGenerator } from './snapshot-generator';
import type {
  StructuralExecutor,
  ProfileExecutor,
  TerminologyExecutor,
  ReferenceExecutor,
  InvariantExecutor,
  CustomRuleExecutor,
  MetadataExecutor
} from './executors';
import type { BestPracticeValidator } from '../validators/best-practice-validator';
import { createValidationErrorIssue, getValueAtPath } from './validation-utils';
import { loadProfileOrBase, createProfileFallbackIssue } from './profile-loader-utils';
import { deepProfileValidator } from '../validators/deep-profile-validator';
import { deepBindingValidator } from '../validators/deep-binding-validator';
import { sdFHIRPathExecutor } from '../validators/sd-fhirpath-executor';
import { observationInvariantsValidator } from '../validators/observation-invariants-validator';
import { resourceSpecificConstraintsValidator } from '../validators/resource-specific-constraints-validator';
import { containedResourceValidator } from '../validators/contained-resource-validator';
import { universalConstraintsValidator } from '../validators/universal-constraints-validator';
import { terminologyResourceValidator } from '../validators/terminology-resource-validator';
import { applyStrictnessSeverity, resolveStrictnessConfig } from '../strictness';
import { applyAdvisorRules, type AdvisorRule } from '../advisor';

interface MultiAspectDeps {
  sdLoader: StructureDefinitionLoader;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  referenceExecutor: ReferenceExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  bestPracticeValidator: BestPracticeValidator;
  strictMode: boolean;
}

interface AspectResult {
  aspect: string;
  issues: ValidationIssue[];
  validationTime: number;
  isValid: boolean;
}

/**
 * Builds the validateResource callback for multi-aspect batch validation.
 * Each invocation validates a single resource across all enabled aspects
 * and returns a structured breakdown per aspect.
 */
export function buildMultiAspectValidateCallback(
  deps: MultiAspectDeps,
  aspects: string[],
  settings: unknown
): (resource: unknown, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<{
  isValid: boolean;
  aspects: AspectResult[];
}> {
  // Resolve once per batch, not per resource — strictness, aspect
  // severity caps, and advisor rules don't change between resources.
  const typedSettings = settings as ValidationSettings | undefined;
  const { strictness, aspectSeverityFor } = resolveStrictnessConfig(
    typedSettings,
  );
  const advisorRules: AdvisorRule[] =
    typedSettings?.advisorRules ?? [];

  return async (resource: unknown, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => {
    const res = resource as Record<string, unknown>;
    const collectedAspects: AspectResult[] = [];

    const runAspect = async (name: string, fn: () => Promise<ValidationIssue[]>) => {
      const aspectStart = Date.now();
      try {
        const rawIssues = await fn();
        const afterStrictness = applyStrictnessSeverity(rawIssues, strictness, aspectSeverityFor(name));
        const { resultIssues: issues } = applyAdvisorRules(afterStrictness, advisorRules);
        const time = Date.now() - aspectStart;
        collectedAspects.push({
          aspect: name,
          issues,
          validationTime: time,
          isValid: issues.every(i => i.severity !== 'error' && i.severity !== 'fatal')
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const time = Date.now() - aspectStart;
        collectedAspects.push({
          aspect: name,
          issues: [createValidationErrorIssue(name, 'internal-error', msg)],
          validationTime: time,
          isValid: false
        });
      }
    };

    const loadResult = await loadProfileOrBase(
      deps.sdLoader,
      deps.snapshotGenerator,
      profileUrl,
      res.resourceType as string,
      fhirVersion
    );
    const structureDef = loadResult.structureDef;

    if (!structureDef) {
      const issue = createValidationErrorIssue(
        'profile',
        'profile-not-found',
        `Profile ${profileUrl} not found and base StructureDefinition for ${res.resourceType} could not be loaded`,
        { profile: profileUrl },
        'meta.profile'
      );
      return {
        isValid: false,
        aspects: [{ aspect: 'profile', issues: [issue], validationTime: 0, isValid: false }]
      };
    }

    // Declared profile was unresolvable but base SD loaded — surface a warning
    // and keep running all other aspects. Without this, callers got back a
    // single info issue and no structural/invariant/reference feedback.
    const profileFallbackIssue: ValidationIssue | null = loadResult.usedBaseFallback
      ? createProfileFallbackIssue(profileUrl, res.resourceType as string)
      : null;

    const ctx = {
      resource: res,
      resourceType: res.resourceType as string,
      profileUrl,
      fhirVersion,
      structureDef,
      strictMode: deps.strictMode,
      settings
    };

    // 1. Structural (runs first — validates basic structure)
    if (aspects.includes('structural')) {
      await runAspect('structural', async () => {
        const structuralIssues = await deps.structuralExecutor.validate(ctx.resource, {
          ...ctx,
          getValueAtPath
        });
        const bestPracticeIssues = deps.bestPracticeValidator.validate({
          resource: ctx.resource,
          resourceType: ctx.resourceType,
          profileUrl: ctx.profileUrl
        });
        return [...structuralIssues, ...bestPracticeIssues];
      });
    }

    // 2–7. Remaining aspects run in parallel for performance
    const parallelAspects: Promise<void>[] = [];

    if (aspects.includes('profile')) {
      parallelAspects.push(runAspect('profile', async () => {
        const profileIssues = await deps.profileExecutor.validate({ ...ctx, getValueAtPath });
        const deepProfileIssues = ctx.structureDef
          ? deepProfileValidator.validate({
            resource: ctx.resource,
            resourceType: ctx.resourceType,
            structureDef: ctx.structureDef,
            profileUrl: ctx.profileUrl
          })
          : [];
        const sdFHIRPathIssues = ctx.structureDef
          ? await sdFHIRPathExecutor.execute({
            resource: ctx.resource,
            resourceType: ctx.resourceType,
            structureDef: ctx.structureDef,
            fhirVersion: ctx.fhirVersion
          })
          : [];
        return [
          ...(profileFallbackIssue ? [profileFallbackIssue] : []),
          ...profileIssues,
          ...deepProfileIssues,
          ...sdFHIRPathIssues,
        ];
      }));
    } else if (profileFallbackIssue) {
      // Even without the profile aspect requested, the fallback warning must
      // still reach the caller — otherwise the unresolvable profile is silent.
      parallelAspects.push(runAspect('profile', async () => [profileFallbackIssue]));
    }

    if (aspects.includes('terminology')) {
      parallelAspects.push(runAspect('terminology', async () => {
        const terminologyIssues = await deps.terminologyExecutor.validate({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          getValueAtPath
        });
        const deepBindingIssues = deepBindingValidator.validate({
          resource: ctx.resource,
          resourceType: ctx.resourceType,
          structureDef: ctx.structureDef
        });
        return [...terminologyIssues, ...deepBindingIssues];
      }));
    }

    if (aspects.includes('reference')) {
      parallelAspects.push(runAspect('reference', () =>
        deps.referenceExecutor.validate({
          resource: ctx.resource,
          fhirVersion: ctx.fhirVersion,
          settings: settings as ValidationSettings | undefined,
        })
      ));
    }

    if (aspects.includes('invariant')) {
      parallelAspects.push(runAspect('invariant', async () => {
        const invariantIssues = await deps.invariantExecutor.validate({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          profileUrl: ctx.profileUrl
        });
        return [
          ...invariantIssues,
          ...observationInvariantsValidator.validate(ctx.resource),
          ...resourceSpecificConstraintsValidator.validate(ctx.resource),
          ...containedResourceValidator.validate(ctx.resource),
          ...universalConstraintsValidator.validate(ctx.resource),
          ...terminologyResourceValidator.validate(ctx.resource)
        ];
      }));
    }

    if (aspects.includes('customRule')) {
      parallelAspects.push(runAspect('customRule', () =>
        deps.customRuleExecutor.validate({ resource: ctx.resource, structureDef: ctx.structureDef, fhirVersion: ctx.fhirVersion })
      ));
    }

    if (aspects.includes('metadata')) {
      parallelAspects.push(runAspect('metadata', () =>
        deps.metadataExecutor.validate({ resource: ctx.resource }, ctx.profileUrl)
      ));
    }

    if (parallelAspects.length > 0) {
      await Promise.all(parallelAspects);
    }

    return {
      isValid: collectedAspects.every(a => a.isValid),
      aspects: collectedAspects
    };
  };
}
