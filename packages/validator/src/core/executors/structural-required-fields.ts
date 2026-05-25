import type { ValidationIssue } from '../../types';
import type { StructureDefinition } from '../structure-definition-types';
import type { ComplexTypeValidator } from '../../validators/complex-type-validator';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules';
import { logger } from '../../logger';
import { getDirectValue } from './structural-executor-helpers';
import { shouldSkipSnapshotElement } from './structural-element-rules';

interface RequiredFieldsValidationInput {
  resource: any;
  structureDef: StructureDefinition;
  profileUrl: string;
  getValueAtPath: (resource: any, path: string) => any;
  fhirVersion: 'R4' | 'R5' | 'R6';
  complexTypeValidator: ComplexTypeValidator;
}

function buildMissingRequiredIssue(path: string, profileUrl: string): ValidationIssue {
  return {
    id: `records-required-${path}-${Date.now()}`,
    aspect: 'structural',
    severity: 'error',
    code: 'required-element-missing',
    message: `Required element '${path}' is missing`,
    path,
    timestamp: new Date(),
    profile: profileUrl,
  };
}

export async function validateRequiredSnapshotFields({
  resource,
  structureDef,
  profileUrl,
  getValueAtPath,
  fhirVersion,
  complexTypeValidator,
}: RequiredFieldsValidationInput): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  try {
    if (!structureDef.snapshot?.element) return issues;

    for (const elementDef of structureDef.snapshot.element) {
      if (shouldSkipSnapshotElement(elementDef, resource.resourceType)) continue;
      if (!elementDef.min || elementDef.min <= 0) continue;

      const path = elementDef.path;
      const validationTargets = getValidationTargets(resource, path);

      if (validationTargets.length === 0) {
        const value = getValueAtPath(resource, path);
        const directValue = getDirectValue(resource, path);
        const isEmptyArray = Array.isArray(directValue) && directValue.length === 0;

        if (value === undefined || value === null || isEmptyArray) {
          if (shouldValidateRequired(resource, path)) {
            issues.push(buildMissingRequiredIssue(path, profileUrl));
          }
          continue;
        }

        const complexTypeIssues = await complexTypeValidator.validateComplexTypeSubElements(
          value,
          elementDef,
          path,
          profileUrl,
          structureDef,
          fhirVersion
        );
        issues.push(...complexTypeIssues);
        continue;
      }

      for (const target of validationTargets) {
        if (target.value === undefined || target.value === null) {
          if (shouldValidateRequired(resource, target.contextPath)) {
            issues.push(buildMissingRequiredIssue(target.fullPath, profileUrl));
          }
          continue;
        }

        const complexTypeIssues = await complexTypeValidator.validateComplexTypeSubElements(
          target.value,
          elementDef,
          target.fullPath,
          profileUrl,
          structureDef,
          fhirVersion
        );
        issues.push(...complexTypeIssues);
      }
    }

    return issues;
  } catch (error) {
    logger.error('[StructuralExecutor] Required fields validation error:', error);
    return [{
      id: `structural-required-error-${Date.now()}`,
      aspect: 'structural',
      severity: 'error',
      code: 'validation-error',
      message: `Required fields validation failed: ${error instanceof Error ? error.message : String(error)}`,
      path: '',
      timestamp: new Date(),
    }];
  }
}
