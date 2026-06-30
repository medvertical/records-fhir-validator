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
import type { ProfileCache } from '../cache/profile-cache';
import type { FhirClientLike, ProfileLoadResult } from './profile-loader-utils';
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
import { createValidationErrorIssue, dedupeIssues, getValueAtPath, suppressRedundantBindingWarnings } from './validation-utils';
import {
  createProfileFallbackIssue,
  createProfileResourceTypeMismatchIssue,
  loadProfileOrBase,
} from './profile-loader-utils';
import { deepProfileValidator } from '../validators/deep-profile-validator';
import { deepBindingValidator } from '../validators/deep-binding-validator';
import { sdFHIRPathExecutor } from '../validators/sd-fhirpath-executor';
import { containedResourceValidator } from '../validators/contained-resource-validator';
import { universalConstraintsValidator } from '../validators/universal-constraints-validator';
import { terminologyResourceValidator } from '../validators/terminology-resource-validator';
import { applyStrictnessSeverity, applyPublicationEscalation, isForPublication, resolveStrictnessConfig } from '../strictness';
import { applyAdvisorRules, type AdvisorRule } from '../advisor';
import { createBundleReferenceResolver } from './multi-aspect-bundle-reference-resolver';
import { appendBundleEntryValidationResults } from './multi-aspect-bundle-entry-validation';
import { validateReferenceTargetProfileConformance } from './multi-aspect-target-profile-conformance';
import { ReferenceTargetValidator } from '../validators/reference-target-validator';
import type { AspectResult, MultiAspectValidateResult, ValidateOneFn } from './multi-aspect-types';

interface MultiAspectDeps {
  sdLoader: StructureDefinitionLoader;
  snapshotGenerator: SnapshotGenerator;
  profileCache?: ProfileCache;
  fhirClient?: FhirClientLike;
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

const BUNDLE_ENTRY_MAX_DEPTH = 3;

// Stateless enumerator for the opt-in target-profile-conformance pass.
const targetProfileConformanceEnumerator = new ReferenceTargetValidator();

/**
 * Builds the validateResource callback for multi-aspect batch validation.
 * Each invocation validates a single resource across all enabled aspects
 * and returns a structured breakdown per aspect.
 */
export function buildMultiAspectValidateCallback(
  deps: MultiAspectDeps,
  aspects: string[],
  settings: unknown,
  organizationId?: number,
): (resource: unknown, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<MultiAspectValidateResult> {
  // Resolve once per batch, not per resource — strictness, aspect
  // severity caps, and advisor rules don't change between resources.
  const typedSettings = settings as ValidationSettings | undefined;
  const { strictness, aspectSeverityFor } = resolveStrictnessConfig(
    typedSettings,
  );
  const advisorRules: AdvisorRule[] =
    typedSettings?.advisorRules ?? [];
  const forPublication = isForPublication(typedSettings);
  const profileLoadCache = new Map<string, Promise<ProfileLoadResult>>();

  const validateOne: ValidateOneFn = async (
    resource: unknown,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
    enclosingBundle?: Record<string, unknown>,
    skipTargetProfileConformance?: boolean,
  ) => {
    const res = resource as Record<string, unknown>;
    const collectedAspects: AspectResult[] = [];

    const runAspect = async (name: string, fn: () => Promise<ValidationIssue[]>) => {
      const aspectStart = Date.now();
      try {
        const rawIssues = await fn();
        const afterStrictness = applyStrictnessSeverity(rawIssues, strictness, aspectSeverityFor(name));
        const { resultIssues: afterAdvisor } = applyAdvisorRules(afterStrictness, advisorRules);
        const issues = applyPublicationEscalation(afterAdvisor, forPublication);
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
    const collectedIssues = () => collectedAspects.flatMap(aspect => aspect.issues);

    const resourceType = res.resourceType as string;
    const profileLoadKey = `${fhirVersion}|${profileUrl}|${resourceType}`;
    let profileLoadPromise = profileLoadCache.get(profileLoadKey);
    if (!profileLoadPromise) {
      profileLoadPromise = loadProfileOrBase(
        deps.sdLoader,
        deps.snapshotGenerator,
        profileUrl,
        resourceType,
        fhirVersion,
        deps.profileCache,
        deps.fhirClient
      );
      profileLoadCache.set(profileLoadKey, profileLoadPromise);
    }
    const loadResult = await profileLoadPromise;
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
    const profileFallbackIssue: ValidationIssue | null = loadResult.incompatibleProfileType
      ? createProfileResourceTypeMismatchIssue(
        profileUrl,
        res.resourceType as string,
        loadResult.incompatibleProfileType,
      )
      : loadResult.usedBaseFallback
        ? createProfileFallbackIssue(profileUrl, res.resourceType as string)
        : null;

    const ctx = {
      resource: res,
      resourceType,
      profileUrl,
      fhirVersion,
      structureDef,
      strictMode: deps.strictMode,
      settings,
      enclosingBundle,
      referenceResolver: createBundleReferenceResolver(enclosingBundle ?? (resourceType === 'Bundle' ? res : undefined), res),
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

    // Profile and terminology run before invariants when the invariant
    // aspect is requested, matching validate()'s existingIssues context.
    const needsInvariantContext = aspects.includes('invariant');
    const preInvariantAspects: Promise<void>[] = [];
    const parallelAspects: Promise<void>[] = [];
    const scheduleAspect = (promise: Promise<void>, contributesToInvariantContext: boolean) => {
      if (needsInvariantContext && contributesToInvariantContext) {
        preInvariantAspects.push(promise);
      } else {
        parallelAspects.push(promise);
      }
    };

    if (aspects.includes('profile')) {
      scheduleAspect(runAspect('profile', async () => {
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
            bundle: ctx.enclosingBundle ?? (ctx.resourceType === 'Bundle' ? ctx.resource : undefined),
            fhirVersion: ctx.fhirVersion
          })
          : [];
        return [
          ...(profileFallbackIssue ? [profileFallbackIssue] : []),
          ...profileIssues,
          ...deepProfileIssues,
          ...sdFHIRPathIssues,
        ];
      }), true);
    } else if (profileFallbackIssue) {
      // Even without the profile aspect requested, the fallback warning must
      // still reach the caller — otherwise the unresolvable profile is silent.
      scheduleAspect(runAspect('profile', async () => [profileFallbackIssue]), false);
    }

    if (aspects.includes('terminology')) {
      scheduleAspect(runAspect('terminology', async () => {
        const terminologyIssues = await deps.terminologyExecutor.validate({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          getValueAtPath,
          fhirVersion: ctx.fhirVersion
        });
        const deepBindingIssues = deepBindingValidator.validate({
          resource: ctx.resource,
          resourceType: ctx.resourceType,
          structureDef: ctx.structureDef
        });
        return [...terminologyIssues, ...deepBindingIssues];
      }), true);
    }

    if (preInvariantAspects.length > 0) {
      await Promise.all(preInvariantAspects);
    }

    if (aspects.includes('reference')) {
      const wantsTargetProfileConformance =
        !skipTargetProfileConformance &&
        (typedSettings?.recursiveReferenceValidation as any)?.validateTargetProfiles === true &&
        !!ctx.referenceResolver;

      parallelAspects.push(runAspect('reference', async () => {
        const referenceIssues = await deps.referenceExecutor.validate({
          resource: ctx.resource,
          fhirVersion: ctx.fhirVersion,
          settings: settings as ValidationSettings | undefined,
        });
        if (!wantsTargetProfileConformance) return referenceIssues;

        const conformanceIssues = await validateReferenceTargetProfileConformance({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          referenceTargetValidator: targetProfileConformanceEnumerator,
          resolveReference: ctx.referenceResolver ?? undefined,
          validateProfile: async (target, profile) => {
            const result = await validateOne(target, profile, ctx.fhirVersion, recursionDepth + 1, enclosingBundle, true);
            return result.aspects.flatMap(aspect => aspect.issues);
          },
        });
        return [...referenceIssues, ...conformanceIssues];
      }));
    }

    if (aspects.includes('invariant')) {
      parallelAspects.push(runAspect('invariant', async () => {
        const invariantIssues = await deps.invariantExecutor.validate({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          profileUrl: ctx.profileUrl,
          existingIssues: collectedIssues()
        });
        return [
          ...invariantIssues,
          ...containedResourceValidator.validate(ctx.resource),
          ...universalConstraintsValidator.validate(ctx.resource),
          ...terminologyResourceValidator.validate(ctx.resource)
        ];
      }));
    }

    if (aspects.includes('custom_rule')) {
      parallelAspects.push(runAspect('custom_rule', () =>
        deps.customRuleExecutor.validate({
          resource: ctx.resource,
          structureDef: ctx.structureDef,
          fhirVersion: ctx.fhirVersion,
          organizationId,
        })
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

    if (resourceType === 'Bundle' && recursionDepth < BUNDLE_ENTRY_MAX_DEPTH) {
      await appendBundleEntryValidationResults(
        res,
        fhirVersion,
        recursionDepth,
        validateOne,
        collectedAspects,
        structureDef,
        issues => applyPublicationEscalation(
          applyAdvisorRules(
            applyStrictnessSeverity(issues, strictness, aspectSeverityFor('profile')),
            advisorRules,
          ).resultIssues,
          forPublication,
        ),
      );
    }

    const processedAspects = normalizeIssuesByAspect(collectedAspects);

    return {
      isValid: processedAspects.every(a => a.isValid),
      aspects: processedAspects,
      structureDef,
    };
  };

  return (resource, profileUrl, fhirVersion) => validateOne(resource, profileUrl, fhirVersion, 0);
}

function normalizeIssuesByAspect(aspects: AspectResult[]): AspectResult[] {
  const suppressedIssues = suppressRedundantBindingWarnings(
    dedupeIssues(aspects.flatMap(aspect => aspect.issues)),
  );
  const keepIssues = new Set(suppressedIssues);

  return aspects.map(aspect => {
    const issues = aspect.issues.filter(issue => keepIssues.has(issue));
    return {
      ...aspect,
      issues,
      isValid: issues.every(issue => issue.severity !== 'error' && issue.severity !== 'fatal'),
    };
  });
}
