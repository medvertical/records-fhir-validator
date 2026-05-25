import type { ValidationIssue } from '../../types';
import {
  validateContainedResourceIdsPresent,
  validateContainedResourcesReferenced,
  validateNoEmptyArrays,
  validateOrphanPrimitiveSidecars,
  validateResourceId,
  validateUniqueContainedResourceIds,
  validateUniqueElementIds,
  validateWhitespaceOnlyPrimitives,
} from './structural-sanity-rules';

interface ResourceSanityValidators {
  attachment: {
    validate(resource: any): ValidationIssue[];
  };
  canonicalResourceInvariant: {
    validate(resource: any): ValidationIssue[];
  };
  structureDefinition: {
    validate(resource: any): ValidationIssue[];
  };
  stringSecurity: {
    validate(resource: any): ValidationIssue[];
  };
  narrative: {
    validateNarrative(resource: any, resourceType: string): ValidationIssue[];
  };
  questionnaire: {
    validateAnyResource(resource: any, contextQuestionnaire?: any): ValidationIssue[];
  };
}

export function validateResourceSanity(
  resource: any,
  validators: ResourceSanityValidators,
  contextQuestionnaire?: any,
): ValidationIssue[] {
  const resourceType = resource?.resourceType || 'Resource';
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
    ...validateWhitespaceOnlyPrimitives(resource, resourceType),
    ...validateOrphanPrimitiveSidecars(resource, resourceType),
  ];

  if (resourceType === 'Questionnaire' || resourceType === 'QuestionnaireResponse') {
    issues.push(...validators.questionnaire.validateAnyResource(resource, contextQuestionnaire));
  }

  return issues;
}
