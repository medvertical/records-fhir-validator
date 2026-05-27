import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';
import {
  buildBundleDocumentContextIssues,
  type BundleDocumentContextChildResult,
} from './bundle-document-context';
import type { AspectResult, MultiAspectValidateResult, ValidateOneFn } from './multi-aspect-types';

const DEFAULT_BUNDLE_ENTRY_VALIDATION_CONCURRENCY = 8;
const MAX_BUNDLE_ENTRY_VALIDATION_CONCURRENCY = 64;

interface BundleChildValidationResult {
  index: number;
  entryResource: Record<string, unknown>;
  resourceType: string;
  result: MultiAspectValidateResult;
}

export async function appendBundleEntryValidationResults(
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
  const concurrency = resolveBundleEntryValidationConcurrency();

  for (let i = 0; i < validationTargets.length; i += concurrency) {
    const chunk = validationTargets.slice(i, i + concurrency);
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
      rewriteEntryIssue(issue, prefix, entryIndex, entryResource, resourceType),
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
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): ValidationIssue {
  const rewritten: ValidationIssue = {
    ...issue,
    path: rewriteEntryPath(issue.path, prefix, resourceType),
    details: attachBundleUnitDetails(issue.details, entryIndex, entryResource, resourceType),
  };
  if (issue.expression) {
    rewritten.expression = rewriteEntryPath(issue.expression, prefix, resourceType);
  }
  return rewritten;
}

function attachBundleUnitDetails(
  details: ValidationIssue['details'],
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): ValidationIssue['details'] {
  const resourceId = typeof entryResource.id === 'string' ? entryResource.id : undefined;
  const bundleUnit = {
    entryIndex,
    resourceType,
    ...(resourceId ? {
      resourceId,
      reference: `${resourceType}/${resourceId}`,
    } : {}),
  };

  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return { ...details, bundleUnit };
  }
  if (details !== undefined && details !== null) {
    return { originalDetails: details, bundleUnit };
  }
  return { bundleUnit };
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
