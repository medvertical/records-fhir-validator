import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateResourceLanguage } from '../../validators/language-code-validator.js';
import {
  validateContainedResourceIdsPresent,
  validateContainedResourcesReferenced,
  validateIllegalXmlCharacterPrimitives,
  validateNoEmptyArrays,
  validateOrphanPrimitiveSidecars,
  validatePrimitiveSidecarArrayAlignment,
  validateResourceId,
  validateUniqueContainedResourceIds,
  validateUniqueElementIds,
  validateWhitespaceOnlyPrimitives,
} from './structural-sanity-rules.js';

interface ResourceSanityValidators {
  attachment: {
    validate(resource: unknown): ValidationIssue[];
  };
  canonicalResourceInvariant: {
    validate(resource: unknown): ValidationIssue[];
  };
  structureDefinition: {
    validate(resource: unknown): ValidationIssue[];
  };
  stringSecurity: {
    validate(resource: unknown): ValidationIssue[];
  };
  narrative: {
    validateNarrative(resource: unknown, resourceType: string): ValidationIssue[];
  };
  questionnaire: {
    validateAnyResource(
      resource: unknown,
      contextQuestionnaire?: unknown,
      options?: ResourceSanityOptions,
      fhirVersion?: 'R4' | 'R5' | 'R6',
    ): ValidationIssue[];
  };
}

interface ResourceSanityOptions {
  warnOnUnresolvedQuestionnaireReference?: boolean;
}

export function validateResourceSanity(
  resource: unknown,
  validators: ResourceSanityValidators,
  contextQuestionnaire?: unknown,
  options: ResourceSanityOptions = {},
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): ValidationIssue[] {
  const resourceType = getResourceType(resource);
  const issues = [
    ...validateResourceId(resource, resourceType),
    ...validateContainedResourceIdsPresent(resource, resourceType),
    ...validateUniqueContainedResourceIds(resource, resourceType),
    ...validateUniqueElementIds(resource, resourceType),
    ...validateNoEmptyArrays(resource, resourceType),
    ...validateContainedResourcesReferenced(resource, resourceType),
    ...validators.attachment.validate(resource),
    ...validators.canonicalResourceInvariant.validate(resource),
    ...validators.structureDefinition.validate(resource),
    ...validators.stringSecurity.validate(resource),
    ...validators.narrative.validateNarrative(resource, resourceType),
    ...validateResourceLanguage(resource, resourceType),
    ...validateWhitespaceOnlyPrimitives(resource, resourceType),
    ...validateIllegalXmlCharacterPrimitives(resource, resourceType),
    ...validateOrphanPrimitiveSidecars(resource, resourceType),
    ...validatePrimitiveSidecarArrayAlignment(resource, resourceType),
  ];

  if (resourceType === 'Questionnaire' || resourceType === 'QuestionnaireResponse') {
    issues.push(...validators.questionnaire.validateAnyResource(
      resource,
      contextQuestionnaire,
      options,
      fhirVersion,
    ));
  }

  return issues;
}

function getResourceType(resource: unknown): string {
  if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) {
    return 'Resource';
  }
  const resourceType = (resource as Record<string, unknown>).resourceType;
  return typeof resourceType === 'string' && resourceType.length > 0
    ? resourceType
    : 'Resource';
}
