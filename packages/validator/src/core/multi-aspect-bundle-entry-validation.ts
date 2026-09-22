import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from "./structure-definition-types.js";
import {
  buildBundleDocumentContextIssues,
  type BundleDocumentContextChildResult,
} from "./bundle-document-context.js";
import type {
  AspectResult,
  MultiAspectValidateResult,
  ValidateOneFn,
} from "./multi-aspect-types.js";
import { BatchValidationAbortedError } from "./batch-validator.js";
import { logger } from "../logger.js";
import { getBundleEntryRequiredProfile } from "./bundle-entry-slice-definitions.js";
import { getDeclaredProfiles } from "./declared-profile-utils.js";
import { mapBundleEntryIssues } from './bundle-entry-validation-output.js';
import { awaitAllDrained } from '../utils/await-all-drained.js';
import { validateBundleCompositionTargets } from './bundle-composition-target-validation.js';

const DEFAULT_BUNDLE_ENTRY_VALIDATION_CONCURRENCY = 16;
const MAX_BUNDLE_ENTRY_VALIDATION_CONCURRENCY = 64;
const LARGE_BUNDLE_ENTRY_LOG_THRESHOLD = 100;

interface BundleChildValidationResult {
  index: number;
  entryResource: Record<string, unknown>;
  resourceType: string;
  profileUrl: string;
  result: MultiAspectValidateResult;
}

export async function appendBundleEntryValidationResults(
  bundle: Record<string, unknown>,
  fhirVersion: "R4" | "R5" | "R6",
  recursionDepth: number,
  validateOne: ValidateOneFn,
  parentAspects: AspectResult[],
  parentStructureDef: StructureDefinition | undefined,
  transformDocumentContextIssues: (
    issues: ValidationIssue[],
  ) => { resultIssues: ValidationIssue[]; evidenceIssues: ValidationIssue[] },
  shouldStop?: () => boolean,
  onEntryValidated?: (
    resource: Record<string, unknown>,
    result: MultiAspectValidateResult,
  ) => void | Promise<void>,
): Promise<void> {
  throwIfStopped(shouldStop);
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  if (entries.length === 0) return;

  const validationTargets = entries
    .map((entry, index) => {
      const entryRecord = entry as Record<string, unknown> | undefined;
      const entryResource = entryRecord?.resource as
        Record<string, unknown> | undefined;
      if (!entryResource || typeof entryResource !== "object") return null;
      const resourceType =
        typeof entryResource.resourceType === "string"
          ? entryResource.resourceType
          : null;
      if (!resourceType) return null;

      const declared = getDeclaredProfiles(entryResource);
      const profileUrl =
        declared[0] ||
        getBundleEntryRequiredProfile(
          { entryResource, resourceType },
          parentStructureDef,
        ) ||
        `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
      return { index, entryResource, resourceType, profileUrl };
    })
    .filter(
      (
        target,
      ): target is {
        index: number;
        entryResource: Record<string, unknown>;
        resourceType: string;
        profileUrl: string;
      } => target !== null,
    );

  const childResults: BundleChildValidationResult[] = [];
  const concurrency = resolveBundleEntryValidationConcurrency();
  const shouldLogLargeBundle =
    validationTargets.length >= LARGE_BUNDLE_ENTRY_LOG_THRESHOLD;
  const startTime = Date.now();

  if (shouldLogLargeBundle) {
    logger.info(
      `[RecordsValidator] Large Bundle entry validation: ${validationTargets.length} embedded resources ` +
        `(concurrency=${concurrency}, depth=${recursionDepth})`,
    );
  }

  for (let i = 0; i < validationTargets.length; i += concurrency) {
    throwIfStopped(shouldStop);
    const chunk = validationTargets.slice(i, i + concurrency);
    const chunkResults = await awaitAllDrained(
      chunk.map(async (target) => {
        const result = await validateBundleEntryTarget(
          target,
          validateOne,
          fhirVersion,
          recursionDepth,
          bundle,
          shouldStop,
        );
        await onEntryValidated?.(target.entryResource, result);
        throwIfStopped(shouldStop);
        return {
          index: target.index,
          entryResource: target.entryResource,
          resourceType: target.resourceType,
          profileUrl: target.profileUrl,
          result,
        };
      }),
    );
    childResults.push(...chunkResults);
    throwIfStopped(shouldStop);
  }

  if (shouldLogLargeBundle) {
    logger.info(
      `[RecordsValidator] Large Bundle entry validation completed in ${Date.now() - startTime}ms ` +
        `(${validationTargets.length} embedded resources)`,
    );
  }

  childResults.sort((a, b) => a.index - b.index);
  for (const child of childResults) {
    mergeEntryAspects(
      parentAspects,
      child.result.aspects,
      child.index,
      child.entryResource,
      child.resourceType,
    );
  }

  throwIfStopped(shouldStop);
  const contextChildren = await appendCompositionTargetResults(
    bundle, childResults, parentAspects, validateOne, { fhirVersion, recursionDepth, shouldStop },
  );
  throwIfStopped(shouldStop);
  const documentContextIssues = transformDocumentContextIssues(
    buildBundleDocumentContextIssues(
      bundle,
      contextChildren,
      parentStructureDef,
    ),
  );
  appendIssuesToAspect(parentAspects, "profile", documentContextIssues);
}

async function appendCompositionTargetResults(
  bundle: Record<string, unknown>,
  children: BundleChildValidationResult[],
  parentAspects: AspectResult[],
  validateOne: ValidateOneFn,
  context: { fhirVersion: "R4" | "R5" | "R6"; recursionDepth: number; shouldStop?: () => boolean },
): Promise<BundleDocumentContextChildResult[]> {
  const contextChildren = children.map(toDocumentContextChildResult);
  const additional = await validateBundleCompositionTargets(bundle, contextChildren, async (resource, profileUrl) => {
    const result = await validateBundleEntryTarget(
      { entryResource: resource, profileUrl }, validateOne, context.fhirVersion,
      context.recursionDepth, bundle, context.shouldStop,
    );
    return { issues: result.aspects.flatMap(aspect => aspect.issues),
      resourceType: result.structureDef?.type, value: result };
  });
  for (const { child, assessment } of additional) {
    if (assessment.value) mergeEntryAspects(parentAspects, assessment.value.aspects, child.index, child.entryResource, child.resourceType);
  }
  return contextChildren;
}

async function validateBundleEntryTarget(
  target: {
    entryResource: Record<string, unknown>;
    profileUrl: string;
  },
  validateOne: ValidateOneFn,
  fhirVersion: "R4" | "R5" | "R6",
  recursionDepth: number,
  bundle: Record<string, unknown>,
  shouldStop?: () => boolean,
): Promise<MultiAspectValidateResult> {
  throwIfStopped(shouldStop);
  const result = await validateOne(
    target.entryResource,
    target.profileUrl,
    fhirVersion,
    recursionDepth + 1,
    bundle,
  );
  throwIfStopped(shouldStop);
  return result;
}

function throwIfStopped(shouldStop?: () => boolean): void {
  if (shouldStop?.()) {
    throw new BatchValidationAbortedError();
  }
}

function resolveBundleEntryValidationConcurrency(): number {
  const rawValue = process.env.VALIDATION_BUNDLE_ENTRY_CONCURRENCY;
  if (!rawValue) return DEFAULT_BUNDLE_ENTRY_VALIDATION_CONCURRENCY;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BUNDLE_ENTRY_VALIDATION_CONCURRENCY;
  }

  return Math.min(parsed, MAX_BUNDLE_ENTRY_VALIDATION_CONCURRENCY);
}

function toDocumentContextChildResult(
  child: BundleChildValidationResult,
): BundleDocumentContextChildResult {
  return {
    index: child.index,
    entryResource: child.entryResource,
    resourceType: child.resourceType,
    issues: child.result.aspects.flatMap((aspect) => aspect.issues),
    structureDef: child.result.structureDef,
    validatedProfile: child.profileUrl,
  };
}

function mergeEntryAspects(
  parentAspects: AspectResult[],
  childAspects: AspectResult[],
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): void {
  for (const childAspect of childAspects) {
    const context = {
      entryIndex,
      resourceType,
      resourceId:
        typeof entryResource.id === "string" ? entryResource.id : undefined,
      includeBundleUnitDetails: true,
    };
    const { parentIssues: rewrittenIssues } = mapBundleEntryIssues(
      childAspect.issues,
      context,
    );
    const { parentIssues: rewrittenEvidence } = mapBundleEntryIssues(
      childAspect.evidenceIssues ?? childAspect.issues,
      { ...context, includeSuppressed: true },
    );
    if (rewrittenIssues.length === 0 && rewrittenEvidence.length === 0)
      continue;

    let parentAspect = parentAspects.find(
      (aspect) => aspect.aspect === childAspect.aspect,
    );
    if (!parentAspect) {
      parentAspect = {
        aspect: childAspect.aspect,
        issues: [],
        evidenceIssues: [],
        validationTime: 0,
        isValid: true,
      };
      parentAspects.push(parentAspect);
    }

    parentAspect.evidenceIssues ??= [...parentAspect.issues];
    parentAspect.issues.push(...rewrittenIssues);
    parentAspect.evidenceIssues.push(...rewrittenEvidence);
    parentAspect.validationTime += childAspect.validationTime;
    parentAspect.isValid = parentAspect.issues.every(
      (issue) => issue.severity !== "error" && issue.severity !== "fatal",
    );
  }
}

function appendIssuesToAspect(
  parentAspects: AspectResult[],
  aspectName: string,
  governed: { resultIssues: ValidationIssue[]; evidenceIssues: ValidationIssue[] },
): void {
  if (governed.resultIssues.length === 0 && governed.evidenceIssues.length === 0) return;
  let parentAspect = parentAspects.find(
    (aspect) => aspect.aspect === aspectName,
  );
  if (!parentAspect) {
    parentAspect = {
      aspect: aspectName,
      issues: [],
      evidenceIssues: [],
      validationTime: 0,
      isValid: true,
    };
    parentAspects.push(parentAspect);
  }

  parentAspect.evidenceIssues ??= [...parentAspect.issues];
  appendUniqueIssues(parentAspect.issues, governed.resultIssues);
  appendUniqueIssues(parentAspect.evidenceIssues, governed.evidenceIssues);
  parentAspect.isValid = parentAspect.issues.every(
    (issue) => issue.severity !== "error" && issue.severity !== "fatal",
  );
}

function appendUniqueIssues(target: ValidationIssue[], issues: ValidationIssue[]): void {
  const existing = new Set(target.map(issue => `${issue.code}|${issue.path}|${issue.message}`));
  for (const issue of issues) {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (existing.has(key)) continue;
    existing.add(key);
    target.push(issue);
  }
}
