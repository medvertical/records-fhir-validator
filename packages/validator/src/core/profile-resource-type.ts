import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from './structure-definition-types.js';
import { getFhirPathModel } from './fhirpath-context.js';
import { matchesRequestedFhirVersion } from './sd-loader-version-utils.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
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
  fhirVersion: 'R4' | 'R5' | 'R6',
): string | undefined {
  const profileResourceType = getStructureDefinitionResourceType(structureDef);
  if (!profileResourceType) return undefined;
  if (profileResourceType === 'Resource' || profileResourceType === 'DomainResource') {
    if (!structureDef) return undefined;
    const definition = structureDef.type === profileResourceType
      ? structureDef : { ...structureDef, type: profileResourceType };
    return profileResourceTypeApplicability(definition, resourceType, fhirVersion) === false
      ? profileResourceType : undefined;
  }
  return profileResourceType === resourceType ? undefined : profileResourceType;
}

export function isUsableResourceBaseProfile(
  structureDef: StructureDefinition | null | undefined,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): structureDef is StructureDefinition {
  return structureDef?.kind === 'resource' && structureDef.abstract === false
    && structureDef.url === `http://hl7.org/fhir/StructureDefinition/${resourceType}`
    && getStructureDefinitionResourceType(structureDef) === resourceType
    && (structureDef.fhirVersion === undefined || typeof structureDef.fhirVersion === 'string')
    && matchesRequestedFhirVersion(structureDef, fhirVersion)
    && Array.isArray(structureDef.snapshot?.element) && structureDef.snapshot.element.length > 0;
}

export function createProfileResourceTypeMismatchIssue(
  profileUrl: string,
  resourceType: string,
  profileResourceType: string,
  validatedAgainstBase = true,
): ValidationIssue {
  return createValidationErrorIssue(
    'structural',
    'structural-resource-type-mismatch',
    (
      `Profile ${profileUrl} is for ${profileResourceType}, but the resource is ${resourceType}; ` +
      (validatedAgainstBase
        ? `validated against base ${resourceType} instead.`
        : `base ${resourceType} could not be validated.`)
    ),
    {
      profile: profileUrl,
      profileResourceType,
      resourceType,
      ...(!validatedAgainstBase ? { validatedAgainstBase: false, validationComplete: false } : {}),
    },
    'meta.profile',
  );
}

/** Ancestry permits evaluation; it is not evidence of profile conformance. */
export function profileResourceTypeApplicability(
  structureDef: StructureDefinition,
  resourceType: unknown,
  fhirVersion: 'R4' | 'R5' | 'R6',
): boolean | undefined {
  const profileType = structureDef.type;
  if (profileType !== resourceType && profileType !== 'Resource' && profileType !== 'DomainResource') return false;
  const concrete = concreteResourceAdmission(structureDef, resourceType, fhirVersion);
  if (concrete !== true) return concrete;
  if (profileType === resourceType) return true;
  // The available R6 FHIRPath model is an R5 fallback, not an R6 hierarchy.
  if (fhirVersion === 'R6' || structureDef.kind !== 'resource') return undefined;
  if (!hasCompatiblePublication(structureDef, fhirVersion)) return undefined;
  if (typeof resourceType !== 'string') return undefined;
  const parents = getFhirPathModel(fhirVersion).type2Parent;
  if (!Object.hasOwn(parents, resourceType)) return undefined;
  const visited = new Set<string>();
  let current: string | undefined = resourceType;
  while (current && !visited.has(current)) {
    if (current === profileType) return true;
    visited.add(current);
    current = parents[current];
  }
  return false;
}

/** Keep the selected source intact while applying its inherited rules to an instance. */
export function profileForConcreteResource(
  structureDef: StructureDefinition,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): StructureDefinition {
  if (structureDef.type === resourceType
    || !['Resource', 'DomainResource'].includes(structureDef.type)
    || profileResourceTypeApplicability(structureDef, resourceType, fhirVersion) !== true) return structureDef;
  const mapElements = (elements: ElementDefinition[]) => elements.map(element => ({
    ...element,
    path: concreteElementAddress(element.path, structureDef.type, resourceType),
    ...(element.id === undefined ? {} : { id: concreteElementAddress(element.id, structureDef.type, resourceType) }),
    ...(element.contentReference?.startsWith('#') ? {
      contentReference: '#' + concreteElementAddress(element.contentReference.slice(1), structureDef.type, resourceType),
    } : {}),
  }));
  return {
    ...structureDef,
    ...(structureDef.snapshot ? { snapshot: { ...structureDef.snapshot, element: mapElements(structureDef.snapshot.element) } } : {}),
    ...(structureDef.differential ? { differential: {
      ...structureDef.differential, element: mapElements(structureDef.differential.element),
    } } : {}),
  };
}

function concreteResourceAdmission(
  structureDef: StructureDefinition,
  resourceType: unknown,
  fhirVersion: 'R4' | 'R5' | 'R6',
): boolean | undefined {
  if (resourceType === 'Resource' || resourceType === 'DomainResource') return false;
  if (typeof resourceType !== 'string') return undefined;
  // Exact selected resource-kind identity needs no borrowed R5 ancestry for R6.
  if (fhirVersion === 'R6') {
    return structureDef.type === resourceType && structureDef.kind === 'resource'
      && KNOWN_FHIR_RESOURCE_TYPES.has(resourceType) ? true : undefined;
  }
  const parents = getFhirPathModel(fhirVersion).type2Parent;
  if (!Object.hasOwn(parents, resourceType)) return undefined;
  const visited = new Set<string>();
  let current: string | undefined = resourceType;
  while (current && !visited.has(current)) {
    if (current === 'Resource') return KNOWN_FHIR_RESOURCE_TYPES.has(resourceType) ? true : undefined;
    visited.add(current);
    current = parents[current];
  }
  return false;
}

function concreteElementAddress(address: string, abstractType: string, resourceType: string): string {
  return address === abstractType || address.startsWith(abstractType + '.') || address.startsWith(abstractType + ':')
    ? resourceType + address.slice(abstractType.length) : address;
}

function hasCompatiblePublication(structureDef: StructureDefinition, fhirVersion: 'R4' | 'R5'): boolean {
  try {
    const publication = structureDef.fhirVersion;
    if (publication === undefined) return true;
    return typeof publication === 'string' && new RegExp(`^${fhirVersion === 'R4' ? '4' : '5'}\\.\\d+\\.\\d+$`).test(publication);
  } catch {
    return false;
  }
}
