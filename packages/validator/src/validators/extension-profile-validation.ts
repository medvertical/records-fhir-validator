import type { ValidationIssue } from '@records-fhir/validation-types';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
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
}: ValidateExtensionProfileParams): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const profileCacheKey = `${context.fhirVersion}|${profileUrl}`;
  let structureDef: StructureDefinition | null | undefined = profileCache.get(profileCacheKey);
  if (structureDef === undefined) {
    try {
      structureDef = await sdLoader.loadProfile(profileUrl, context.fhirVersion);
    } catch (error: unknown) {
      logger.warn('[ExtensionValidator] Failed to load extension profile', {
        ...profileCanonicalMetadata(profileUrl),
        ...validationFailureMetadata(error),
      });
      structureDef = null;
    }
    if (structureDef) profileCache.set(profileCacheKey, structureDef);
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
    rootResource: context.resource,
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
    resourceType,
    details: {
      ...(typeof issue.details === 'object' && issue.details !== null ? issue.details : {}),
      fieldPath: rebasedPath,
      resourceType,
    },
  };
}
