import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ProfileCache } from '../cache/profile-cache.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import { buildBundleDocumentContextIssues, type BundleDocumentContextChildResult } from './bundle-document-context.js';
import { loadProfileWithSnapshot } from './profile-loader-utils.js';
import { inferCodeBasedProfiles } from './code-inferred-profiles.js';
import { getBundleEntryRequiredProfile } from './bundle-entry-slice-definitions.js';
import { isFhirResource, type FhirResource } from './fhir-resource.js';
import { validateBundleCompositionTargets } from './bundle-composition-target-validation.js';
import {
  createBundleEntryValidationFailureIssue,
  mapBundleEntryIssues,
} from './bundle-entry-validation-output.js';

export interface BundleEntryValidationDeps {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  maxDepth: number;
  structuralExecutor: {
    validateResourceIdAndArrays(resource: FhirResource, contextQuestionnaire?: unknown): ValidationIssue[];
  };
  validateResource(
    resource: FhirResource,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]>;
  validateNestedBundleEntries(
    bundle: FhirResource,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number,
  ): Promise<ValidationIssue[]>;
}

export async function validateBundleEntryResources(
  bundle: FhirResource,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  deps: BundleEntryValidationDeps,
): Promise<ValidationIssue[]> {
  const out: ValidationIssue[] = [];
  const childResults: BundleDocumentContextChildResult[] = [];
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  if (entries.length === 0) return out;

  const bundleProfileUrl = getDeclaredProfile(bundle)
    ?? 'http://hl7.org/fhir/StructureDefinition/Bundle';
  const bundleStructureDef = await loadProfileWithSnapshot(
    deps.sdLoader,
    deps.profileCache,
    deps.snapshotGenerator,
    bundleProfileUrl,
    fhirVersion,
  ) ?? undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = asRecord(entries[i]);
    const entryResource = entry?.resource;
    if (!isFhirResource(entryResource)) continue;

    // The base canonical is the last resort, not the second: between the two
    // sit the profiles the specification implies from the resource's own code,
    // and naming the base instead told the engine to stop looking.
    const profileUrl = getDeclaredProfile(entryResource) || getBundleEntryRequiredProfile(
      { entryResource, resourceType: entryResource.resourceType },
      bundleStructureDef,
    ) || inferCodeBasedProfiles(entryResource)[0]
      || `http://hl7.org/fhir/StructureDefinition/${entryResource.resourceType}`;

    let entryIssues: ValidationIssue[];
    try {
      entryIssues = await deps.validateResource(entryResource, profileUrl, fhirVersion);
      entryIssues.push(...deps.structuralExecutor.validateResourceIdAndArrays(entryResource));
      if (entryResource.resourceType === 'Bundle' && recursionDepth < deps.maxDepth) {
        entryIssues.push(...(await deps.validateNestedBundleEntries(entryResource, fhirVersion, recursionDepth + 1)));
      }
    } catch {
      const failureIssue = createBundleEntryValidationFailureIssue(i, entryResource.resourceType);
      out.push(failureIssue);
      childResults.push({
        index: i,
        entryResource,
        resourceType: entryResource.resourceType,
        issues: [failureIssue],
      });
      continue;
    }

    const mappedIssues = mapBundleEntryIssues(entryIssues, {
      entryIndex: i,
      resourceType: entryResource.resourceType,
      resourceId: typeof entryResource.id === 'string' && entryResource.id
        ? entryResource.id
        : undefined,
    });
    out.push(...mappedIssues.parentIssues);

    childResults.push({
      index: i,
      entryResource,
      resourceType: entryResource.resourceType,
      issues: mappedIssues.childIssues,
      validatedProfile: profileUrl,
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

  const additional = await validateBundleCompositionTargets(bundle, childResults, async (resource, profile) => {
    if (!isFhirResource(resource)) throw new Error('Bundle target is not a FHIR resource');
    const structureDef = await loadProfileWithSnapshot(
      deps.sdLoader, deps.profileCache, deps.snapshotGenerator, profile, fhirVersion,
    );
    if (structureDef?.type && structureDef.type !== resource.resourceType) {
      return { issues: [], resourceType: structureDef.type };
    }
    const issues = await deps.validateResource(resource, profile, fhirVersion);
    return { issues, resourceType: structureDef?.type, value: issues };
  });
  for (const { child, assessment } of additional) {
    out.push(...mapBundleEntryIssues(assessment.issues, {
      entryIndex: child.index, resourceType: child.resourceType,
      resourceId: typeof child.entryResource.id === 'string' ? child.entryResource.id : undefined,
    }).parentIssues);
  }
  out.push(...buildBundleDocumentContextIssues(bundle, childResults, bundleStructureDef));
  return out;
}

function getDeclaredProfile(resource: Record<string, unknown>): string | undefined {
  const meta = asRecord(resource.meta);
  return Array.isArray(meta?.profile)
    ? meta.profile.find((profile): profile is string => typeof profile === 'string')
    : typeof meta?.profile === 'string'
      ? meta.profile
      : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
