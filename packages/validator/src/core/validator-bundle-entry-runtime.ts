import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ProfileCache } from '../cache/profile-cache.js';
import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { StructuralExecutor } from './executors/index.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import { validateBundleEntryResources } from './validator-bundle-entry-validation.js';
import {
  BundleReferenceIndexCache,
  createBundleCanonicalResolver,
  createBundleReferenceResolver,
  type BundleCanonicalResolver,
} from './multi-aspect-bundle-reference-resolver.js';
import type { FhirResource } from './fhir-resource.js';

interface ValidatorBundleEntryRuntime {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  maxDepth: number;
  validateResource: (
    resource: FhirResource,
    profileUrl: string | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6',
    referenceResolver: ReferenceResolver | null,
    bundleCanonicalResolver: BundleCanonicalResolver | null,
  ) => Promise<ValidationIssue[]>;
}

export async function validateRecordsBundleEntries(
  bundle: FhirResource,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  runtime: ValidatorBundleEntryRuntime,
  referenceIndexCache = new BundleReferenceIndexCache(),
): Promise<ValidationIssue[]> {
  const bundleCanonicalResolver = createBundleCanonicalResolver(bundle, referenceIndexCache);
  return validateBundleEntryResources(bundle, fhirVersion, recursionDepth, {
    sdLoader: runtime.sdLoader,
    profileCache: runtime.profileCache,
    snapshotGenerator: runtime.snapshotGenerator,
    maxDepth: runtime.maxDepth,
    structuralExecutor: runtime.structuralExecutor,
    validateResource: (resource, profileUrl, version) => runtime.validateResource(
      resource,
      profileUrl,
      version,
      createBundleReferenceResolver(bundle, resource, referenceIndexCache),
      bundleCanonicalResolver,
    ),
    validateNestedBundleEntries: (nestedBundle, version, nextDepth) =>
      validateRecordsBundleEntries(
        nestedBundle,
        version,
        nextDepth,
        runtime,
        referenceIndexCache,
      ),
  });
}
