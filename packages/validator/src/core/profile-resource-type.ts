import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from './structure-definition-types.js';
import { createValidationErrorIssue } from './validation-utils.js';

export function getStructureDefinitionResourceType(
  structureDef: StructureDefinition | null | undefined,
): string | undefined {
  if (!structureDef) return undefined;

  if (typeof structureDef.type === 'string' && structureDef.type.length > 0) {
    return structureDef.type;
  }

  const rootPath = structureDef.snapshot?.element?.[0]?.path ??
    structureDef.differential?.element?.[0]?.path;
  if (typeof rootPath === 'string' && rootPath.length > 0) {
    return rootPath.split('.')[0];
  }

  return undefined;
}

export function getIncompatibleProfileResourceType(
  structureDef: StructureDefinition | null | undefined,
  resourceType: string,
): string | undefined {
  const profileResourceType = getStructureDefinitionResourceType(structureDef);
  if (!profileResourceType) return undefined;
  if (profileResourceType === resourceType) return undefined;
  if (profileResourceType === 'Resource' || profileResourceType === 'DomainResource') return undefined;
  return profileResourceType;
}

export function createProfileResourceTypeMismatchIssue(
  profileUrl: string,
  resourceType: string,
  profileResourceType: string,
): ValidationIssue {
  return createValidationErrorIssue(
    'structural',
    'structural-resource-type-mismatch',
    (
      `Profile ${profileUrl} is for ${profileResourceType}, but the resource is ${resourceType}; ` +
      `validated against base ${resourceType} instead.`
    ),
    {
      profile: profileUrl,
      profileResourceType,
      resourceType,
    },
    'meta.profile',
  );
}
