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
import type { StructureDefinition } from './structure-definition-types';
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
import { createValidationErrorIssue, getValueAtPath } from './validation-utils';
import { loadProfileOrBase, createProfileFallbackIssue } from './profile-loader-utils';
import { deepProfileValidator } from '../validators/deep-profile-validator';
import { deepBindingValidator } from '../validators/deep-binding-validator';
import { sdFHIRPathExecutor } from '../validators/sd-fhirpath-executor';
import { containedResourceValidator } from '../validators/contained-resource-validator';
import { universalConstraintsValidator } from '../validators/universal-constraints-validator';
import { terminologyResourceValidator } from '../validators/terminology-resource-validator';
import { applyStrictnessSeverity, resolveStrictnessConfig } from '../strictness';
import { applyAdvisorRules, type AdvisorRule } from '../advisor';
import type { ReferenceResolver } from '../validators/slicing-validator';
import {
  buildBundleDocumentContextIssues,
  type BundleDocumentContextChildResult,
} from './bundle-document-context';

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

interface AspectResult {
  aspect: string;
  issues: ValidationIssue[];
  validationTime: number;
  isValid: boolean;
}

type MultiAspectValidateResult = {
  isValid: boolean;
  aspects: AspectResult[];
  structureDef?: StructureDefinition;
};

type ValidateOneFn = (
  resource: unknown,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  enclosingBundle?: Record<string, unknown>,
) => Promise<MultiAspectValidateResult>;

const BUNDLE_ENTRY_MAX_DEPTH = 3;
const BUNDLE_ENTRY_VALIDATION_CONCURRENCY = 8;
const bundleReferenceIndexCache = new WeakMap<Record<string, unknown>, BundleReferenceIndex>();

interface BundleReferenceIndex {
  fullUrl: Map<string, any>;
  relative: Map<string, any>;
  hasEntries: boolean;
}

interface BundleChildValidationResult {
  index: number;
  entryResource: Record<string, unknown>;
  resourceType: string;
  result: MultiAspectValidateResult;
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
): (resource: unknown, profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6') => Promise<MultiAspectValidateResult> {
  // Resolve once per batch, not per resource — strictness, aspect
  // severity caps, and advisor rules don't change between resources.
  const typedSettings = settings as ValidationSettings | undefined;
  const { strictness, aspectSeverityFor } = resolveStrictnessConfig(
    typedSettings,
  );
  const advisorRules: AdvisorRule[] =
    typedSettings?.advisorRules ?? [];
  const profileLoadCache = new Map<string, Promise<ProfileLoadResult>>();

  const validateOne: ValidateOneFn = async (
    resource: unknown,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
    enclosingBundle?: Record<string, unknown>,
  ) => {
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
    const profileFallbackIssue: ValidationIssue | null = loadResult.usedBaseFallback
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

    if (resourceType === 'Bundle' && recursionDepth < BUNDLE_ENTRY_MAX_DEPTH) {
      await appendBundleEntryValidationResults(
        res,
        fhirVersion,
        recursionDepth,
        validateOne,
        collectedAspects,
        structureDef,
        issues => applyAdvisorRules(
          applyStrictnessSeverity(issues, strictness, aspectSeverityFor('profile')),
          advisorRules,
        ).resultIssues,
      );
    }

    return {
      isValid: collectedAspects.every(a => a.isValid),
      aspects: collectedAspects,
      structureDef,
    };
  };

  return (resource, profileUrl, fhirVersion) => validateOne(resource, profileUrl, fhirVersion, 0);
}

async function appendBundleEntryValidationResults(
  bundle: Record<string, unknown>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  validateOne: ValidateOneFn,
  parentAspects: AspectResult[],
  parentStructureDef: StructureDefinition | undefined,
  transformDocumentContextIssues: (issues: ValidationIssue[]) => ValidationIssue[],
): Promise<void> {
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  if (entries.length === 0) return;

  const validationTargets = entries
    .map((entry, index) => {
      const entryRecord = entry as Record<string, unknown> | undefined;
      const entryResource = entryRecord?.resource as Record<string, unknown> | undefined;
      if (!entryResource || typeof entryResource !== 'object') return null;
      const resourceType = typeof entryResource.resourceType === 'string'
        ? entryResource.resourceType
        : null;
      if (!resourceType) return null;

      const declared = Array.isArray((entryResource.meta as any)?.profile)
        ? (entryResource.meta as any).profile.filter((profile: unknown): profile is string => typeof profile === 'string')
        : [];
      const profileUrl = declared[0] || `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
      return { index, entryResource, resourceType, profileUrl };
    })
    .filter((target): target is {
      index: number;
      entryResource: Record<string, unknown>;
      resourceType: string;
      profileUrl: string;
    } => target !== null);

  const childResults: BundleChildValidationResult[] = [];

  for (let i = 0; i < validationTargets.length; i += BUNDLE_ENTRY_VALIDATION_CONCURRENCY) {
    const chunk = validationTargets.slice(i, i + BUNDLE_ENTRY_VALIDATION_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async target => ({
      index: target.index,
      entryResource: target.entryResource,
      resourceType: target.resourceType,
      result: await validateOne(target.entryResource, target.profileUrl, fhirVersion, recursionDepth + 1, bundle),
    })));
    childResults.push(...chunkResults);
  }

  childResults.sort((a, b) => a.index - b.index);
  for (const child of childResults) {
    mergeEntryAspects(parentAspects, child.result.aspects, child.index, child.entryResource, child.resourceType);
  }

  const documentContextIssues = transformDocumentContextIssues(
    buildBundleDocumentContextIssues(
      bundle,
      childResults.map(toDocumentContextChildResult),
      parentStructureDef,
    ),
  );
  if (documentContextIssues.length > 0) {
    appendIssuesToAspect(parentAspects, 'profile', documentContextIssues);
  }
}

function toDocumentContextChildResult(
  child: BundleChildValidationResult,
): BundleDocumentContextChildResult {
  return {
    index: child.index,
    entryResource: child.entryResource,
    resourceType: child.resourceType,
    issues: child.result.aspects.flatMap(aspect => aspect.issues),
    structureDef: child.result.structureDef,
  };
}

function mergeEntryAspects(
  parentAspects: AspectResult[],
  childAspects: AspectResult[],
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): void {
  const prefix = bundleEntryResourcePrefix(entryIndex, entryResource, resourceType);

  for (const childAspect of childAspects) {
    const rewrittenIssues = dedupeEntryIssues(childAspect.issues).map(issue =>
      rewriteEntryIssue(issue, prefix, resourceType),
    );
    if (rewrittenIssues.length === 0) continue;

    let parentAspect = parentAspects.find(aspect => aspect.aspect === childAspect.aspect);
    if (!parentAspect) {
      parentAspect = {
        aspect: childAspect.aspect,
        issues: [],
        validationTime: 0,
        isValid: true,
      };
      parentAspects.push(parentAspect);
    }

    parentAspect.issues.push(...rewrittenIssues);
    parentAspect.validationTime += childAspect.validationTime;
    parentAspect.isValid = parentAspect.issues.every(issue =>
      issue.severity !== 'error' && issue.severity !== 'fatal',
    );
  }
}

function dedupeEntryIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }

  return out;
}

function rewriteEntryIssue(
  issue: ValidationIssue,
  prefix: string,
  resourceType: string,
): ValidationIssue {
  const rewritten: ValidationIssue = {
    ...issue,
    path: rewriteEntryPath(issue.path, prefix, resourceType),
  };
  if (issue.expression) {
    rewritten.expression = rewriteEntryPath(issue.expression, prefix, resourceType);
  }
  return rewritten;
}

function rewriteEntryPath(
  path: string | undefined,
  prefix: string,
  resourceType: string,
): string | undefined {
  if (!path) return path;
  if (path === resourceType) return prefix;
  if (path.startsWith(`${resourceType}.`)) return `${prefix}.${path.slice(resourceType.length + 1)}`;
  return `${prefix}.${path}`;
}

function bundleEntryResourcePrefix(
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): string {
  const rtId = typeof entryResource.id === 'string'
    ? `${resourceType}/${entryResource.id}`
    : resourceType;
  return `Bundle.entry[${entryIndex}].resource/*${rtId}*/`;
}

function appendIssuesToAspect(
  parentAspects: AspectResult[],
  aspectName: string,
  issues: ValidationIssue[],
): void {
  if (issues.length === 0) return;
  let parentAspect = parentAspects.find(aspect => aspect.aspect === aspectName);
  if (!parentAspect) {
    parentAspect = {
      aspect: aspectName,
      issues: [],
      validationTime: 0,
      isValid: true,
    };
    parentAspects.push(parentAspect);
  }

  const existing = new Set(parentAspect.issues.map(issue => `${issue.code}|${issue.path}|${issue.message}`));
  for (const issue of issues) {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (existing.has(key)) continue;
    existing.add(key);
    parentAspect.issues.push(issue);
  }
  parentAspect.isValid = parentAspect.issues.every(issue =>
    issue.severity !== 'error' && issue.severity !== 'fatal',
  );
}

function createBundleReferenceResolver(
  bundle: Record<string, unknown> | undefined,
  rootResource: Record<string, unknown>,
): ReferenceResolver | null {
  const contained = Array.isArray((rootResource as any).contained)
    ? (rootResource as any).contained
    : [];
  const bundleIndex = bundle ? getBundleReferenceIndex(bundle) : null;

  if (contained.length === 0 && !bundleIndex?.hasEntries) return null;
  const containedById = contained.length > 0
    ? new Map(contained
      .filter((resource: any) => typeof resource?.id === 'string')
      .map((resource: any) => [resource.id, resource]))
    : null;

  return (reference: string) => {
    if (!reference) return null;

    if (reference.startsWith('#')) {
      const id = reference.slice(1);
      return containedById?.get(id) ?? null;
    }

    return bundleIndex?.fullUrl.get(reference)
      ?? bundleIndex?.relative.get(reference)
      ?? null;
  };
}

function getBundleReferenceIndex(bundle: Record<string, unknown>): BundleReferenceIndex {
  const cached = bundleReferenceIndexCache.get(bundle);
  if (cached) return cached;

  const fullUrl = new Map<string, any>();
  const relative = new Map<string, any>();
  const entries = Array.isArray((bundle as any).entry) ? (bundle as any).entry : [];

  for (const entry of entries) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') continue;

    if (typeof entry.fullUrl === 'string' && !fullUrl.has(entry.fullUrl)) {
      fullUrl.set(entry.fullUrl, resource);
    }

    if (typeof resource.resourceType === 'string' && typeof resource.id === 'string') {
      const key = `${resource.resourceType}/${resource.id}`;
      if (!relative.has(key)) relative.set(key, resource);
    }
  }

  const index = { fullUrl, relative, hasEntries: fullUrl.size > 0 || relative.size > 0 };
  bundleReferenceIndexCache.set(bundle, index);
  return index;
}
