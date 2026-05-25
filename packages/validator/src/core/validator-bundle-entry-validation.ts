import type { ValidationIssue } from '../types';
import type { ProfileCache } from '../cache/profile-cache';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { SnapshotGenerator } from './snapshot-generator';
import { logger } from '../logger';
import { buildBundleDocumentContextIssues, type BundleDocumentContextChildResult } from './bundle-document-context';
import { loadProfileWithSnapshot } from './profile-loader-utils';

export interface BundleEntryValidationDeps {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  maxDepth: number;
  structuralExecutor: {
    validateResourceIdAndArrays(resource: any, contextQuestionnaire?: any): ValidationIssue[];
  };
  validateResource(
    resource: any,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]>;
  validateNestedBundleEntries(
    bundle: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
  ): Promise<ValidationIssue[]>;
}

export async function validateBundleEntryResources(
  bundle: any,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: BundleEntryValidationDeps,
): Promise<ValidationIssue[]> {
  const out: ValidationIssue[] = [];
  const childResults: BundleDocumentContextChildResult[] = [];
  const entries: any[] = Array.isArray(bundle?.entry) ? bundle.entry : [];
  if (entries.length === 0) return out;

  const bundleDeclaredProfiles: string[] = Array.isArray(bundle?.meta?.profile) ? bundle.meta.profile : [];
  const bundleProfileUrl = bundleDeclaredProfiles[0] || 'http://hl7.org/fhir/StructureDefinition/Bundle';
  const bundleStructureDef = await loadProfileWithSnapshot(
    deps.sdLoader,
    deps.profileCache,
    deps.snapshotGenerator,
    bundleProfileUrl,
    fhirVersion,
  ) ?? undefined;

  for (let i = 0; i < entries.length; i++) {
    const entryResource = entries[i]?.resource;
    if (!entryResource || typeof entryResource !== 'object') continue;
    if (!entryResource.resourceType) continue;

    const declared: string[] = Array.isArray(entryResource.meta?.profile) ? entryResource.meta.profile : [];
    const profileUrl = declared[0] || `http://hl7.org/fhir/StructureDefinition/${entryResource.resourceType}`;

    let entryIssues: ValidationIssue[];
    try {
      entryIssues = await deps.validateResource(entryResource, profileUrl, fhirVersion);
      entryIssues.push(...deps.structuralExecutor.validateResourceIdAndArrays(entryResource));
      if (entryResource.resourceType === 'Bundle' && recursionDepth < deps.maxDepth) {
        entryIssues.push(...(await deps.validateNestedBundleEntries(entryResource, fhirVersion, recursionDepth + 1)));
      }
    } catch (error) {
      logger.warn(
        `[RecordsValidator] Bundle entry[${i}] validation threw: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const rtId = entryResource.id ? `${entryResource.resourceType}/${entryResource.id}` : entryResource.resourceType;
    const prefix = `Bundle.entry[${i}].resource/*${rtId}*/`;
    const rtLen = entryResource.resourceType.length;
    const seen = new Set<string>();
    const dedupedEntryIssues: ValidationIssue[] = [];

    for (const issue of entryIssues) {
      const key = `${issue.code}|${issue.path}|${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedEntryIssues.push(issue);
      const rewritten: ValidationIssue = {
        ...issue,
        path: rewriteEntryPath(issue.path, prefix, entryResource.resourceType, rtLen),
      };
      if (issue.expression) {
        rewritten.expression = rewriteEntryPath(issue.expression, prefix, entryResource.resourceType, rtLen);
      }
      out.push(rewritten);
    }

    childResults.push({
      index: i,
      entryResource,
      resourceType: entryResource.resourceType,
      issues: dedupedEntryIssues,
      structureDef: entryResource.resourceType === 'Composition'
        ? await loadProfileWithSnapshot(
          deps.sdLoader,
          deps.profileCache,
          deps.snapshotGenerator,
          profileUrl,
          fhirVersion,
        ) ?? undefined
        : undefined,
    });
  }

  out.push(...buildBundleDocumentContextIssues(bundle, childResults, bundleStructureDef));
  return out;
}

function rewriteEntryPath(
  path: string | undefined,
  prefix: string,
  resourceType: string,
  resourceTypeLength: number,
): string | undefined {
  if (!path) return path;
  if (path === resourceType) return prefix;
  if (path.startsWith(`${resourceType}.`)) return `${prefix}.${path.slice(resourceTypeLength + 1)}`;
  return `${prefix}.${path}`;
}
