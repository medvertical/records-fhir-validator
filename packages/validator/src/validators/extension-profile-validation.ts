import { copyProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { extensionDefinitionCacheKey, loadExtensionProfile, rethrowUnavailableProfile } from './extension-profile-cache.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type {
  ProfileReferenceSource,
  StructureDefinitionLoader,
} from '../core/structure-definition-loader.js';
import { SnapshotGenerator } from '../core/snapshot-generator.js';
import { logger } from '../logger.js';
import type { TypeValidator } from './type-validator.js';
import type { ValueSetValidator } from './valueset-validator.js';
import type { ElementRulesValidator } from './element-rules-validator.js';
import type { ExtensionValidationContext } from './extension-types.js';
import type { SDFHIRPathExecutor } from './sd-fhirpath-executor.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import type { ExtensionProfileCache } from './extension-profile-cache.js';
import { validateExtensionValueElements } from './extension-value-profile-validation.js';
import { focusResourceOf } from './sd-fhirpath-focus-resource.js';
import { validateExtensionValueSlicing } from './extension-value-slicing.js';

interface ValidateExtensionProfileParams {
  extension: Record<string, unknown>;
  profileUrl: string;
  path: string;
  context: ExtensionValidationContext;
  sdLoader: StructureDefinitionLoader;
  typeValidator: TypeValidator;
  valueSetValidator: ValueSetValidator;
  elementRulesValidator: ElementRulesValidator;
  profileCache: ExtensionProfileCache<StructureDefinition>;
  sdFHIRPathExecutor: SDFHIRPathExecutor;
  /** The profile naming `profileUrl`; the validated profile unless nested. */
  referencingProfile?: ProfileReferenceSource;
}

export async function validateAgainstExtensionProfile({
  extension,
  profileUrl,
  path,
  context,
  sdLoader,
  typeValidator,
  valueSetValidator,
  elementRulesValidator,
  profileCache,
  sdFHIRPathExecutor,
  referencingProfile = context.profileSD,
}: ValidateExtensionProfileParams): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  let selected: StructureDefinition | null;
  try { selected = await loadExtensionProfile(sdLoader, profileUrl, referencingProfile, context.fhirVersion); }
  catch (error: unknown) {
    rethrowUnavailableProfile(error);
    logger.warn('[ExtensionValidator] Failed to load extension profile', {
      ...profileCanonicalMetadata(profileUrl), ...validationFailureMetadata(error),
    });
    return issues;
  }
  if (!selected) return issues;
  const profileCacheKey = extensionDefinitionCacheKey(selected, context.fhirVersion);
  const suppliedSnapshot = Boolean(selected.snapshot?.element?.length);
  let structureDef: StructureDefinition | null | undefined = suppliedSnapshot ? profileCache.get(profileCacheKey) : undefined;
  if (structureDef === undefined) {
    structureDef = selected;
    if (structureDef && !structureDef.snapshot?.element?.length && structureDef.differential?.element?.length) {
      const element = await new SnapshotGenerator(sdLoader).generateSnapshot(structureDef, {
        fhirVersion: context.fhirVersion, cacheResults: false,
      });
      const snapshotProfile = { ...structureDef, snapshot: { element } };
      copyProfilePackageProvenance(structureDef, snapshotProfile);
      structureDef = snapshotProfile;
    }
    if (structureDef && suppliedSnapshot) profileCache.set(profileCacheKey, structureDef);
  }

  if (!structureDef?.snapshot?.element) {
    return issues;
  }

  // Extension profiles can declare invariants on their root element. Those
  // constraints are not copied into the containing resource profile's
  // snapshot, so they must be evaluated against the extension instance
  // itself (the same recursive profile step performed by the reference
  // validator). Keep only constraint diagnostics here; the element-level
  // fixed/type/binding rules are handled below and must not be duplicated.
  const extensionResource = {
    resourceType: 'Extension',
    ...extension,
  };
  const constraintIssues = await sdFHIRPathExecutor.execute({
    resource: extensionResource,
    rootResource: context.rootResource ?? context.resource,
    focusResource: context.rootResource ? context.resource : focusResourceOf(context.resource, path),
    resourceType: 'Extension',
    structureDef,
    fhirVersion: context.fhirVersion,
  });
  issues.push(...constraintIssues
    .filter(issue => Boolean(issue.ruleId))
    .map(issue => rebaseExtensionConstraintIssue(
      issue,
      path,
      resourceTypeOf(context.resource, 'Unknown'),
    )));
  issues.push(...(await validateExtensionValueSlicing(extensionResource, structureDef, context, sdLoader))
    .map(issue => rebaseExtensionConstraintIssue(issue, path, resourceTypeOf(context.resource, 'Unknown'))));

  const valueElements = structureDef.snapshot.element.filter(
    (el) => el.path?.startsWith('Extension.value')
  );

  issues.push(...await validateExtensionValueElements({
    extension,
    valueElements,
    path,
    profileUrl,
    context,
    typeValidator,
    valueSetValidator,
    elementRulesValidator,
    definition: structureDef,
  }));
  return issues;
}

function rebaseExtensionConstraintIssue(
  issue: ValidationIssue,
  extensionPath: string,
  resourceType: string,
): ValidationIssue {
  const issuePath = issue.path || 'Extension';
  const rebasedPath = issuePath === 'Extension'
    ? extensionPath
    : issuePath.startsWith('Extension.')
      ? `${extensionPath}${issuePath.slice('Extension'.length)}`
      : extensionPath;
  return {
    ...issue,
    path: rebasedPath,
    ...(issue.target ? { target: { ...issue.target, path: rebasedPath } } : {}),
    resourceType,
    details: {
      ...(typeof issue.details === 'object' && issue.details !== null ? issue.details : {}),
      fieldPath: rebasedPath,
      resourceType,
    },
  };
}
