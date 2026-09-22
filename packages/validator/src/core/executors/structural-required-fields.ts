import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
  ElementDefinition,
  StructureDefinition,
} from '../structure-definition-types.js';
import type { ComplexTypeValidator } from '../../validators/complex-type-validator.js';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules/index.js';
import { logger } from '../../logger.js';
import { getDirectValue } from './structural-executor-helpers.js';
import { shouldSkipSnapshotElement } from './structural-element-rules.js';
import { createValidationErrorIssue } from '../core-validation-issue.js';
import { createExecutorFailureIssue } from './executor-failure-issue.js';
import { sensitiveValueMetadata } from '../../utils/sensitive-logging-metadata.js';

interface RequiredFieldsValidationInput {
  resource: Record<string, unknown>;
  structureDef: StructureDefinition;
  profileUrl: string;
  getValueAtPath: (resource: Record<string, unknown>, path: string) => unknown;
  fhirVersion: 'R4' | 'R5' | 'R6';
  complexTypeValidator: ComplexTypeValidator;
}

function buildMissingRequiredIssue(path: string, profileUrl: string): ValidationIssue {
  return {
    ...createValidationErrorIssue(
      'structural',
      'required-element-missing',
      `Required element '${path}' is missing`,
      undefined,
      path,
    ),
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
    if (!Array.isArray(structureDef.snapshot?.element)) return issues;
    const resourceType = getResourceType(resource);

    for (const candidate of structureDef.snapshot.element) {
      if (!isElementDefinition(candidate)) continue;
      if (shouldSkipSnapshotElement(candidate, resourceType)) continue;
      if (typeof candidate.min !== 'number' || candidate.min <= 0) continue;
      try {
        issues.push(...await validateRequiredElement(
          resource,
          candidate,
          profileUrl,
          getValueAtPath,
          fhirVersion,
          structureDef,
          complexTypeValidator,
        ));
      } catch {
        logger.error('[StructuralExecutor] Required element validation failed', {
          ...sensitiveValueMetadata(candidate.path),
        });
        issues.push(createExecutorFailureIssue(
          'structural',
          'Required fields',
          candidate.path,
          { elementPath: candidate.path },
        ));
      }
    }

    return issues;
  } catch {
    logger.error('[StructuralExecutor] Required fields validation failed');
    return [
      ...issues,
      createExecutorFailureIssue('structural', 'Required fields'),
    ];
  }
}

async function validateRequiredElement(
  resource: Record<string, unknown>,
  elementDef: ElementDefinition,
  profileUrl: string,
  getValueAtPath: (
    resource: Record<string, unknown>,
    path: string,
  ) => unknown,
  fhirVersion: 'R4' | 'R5' | 'R6',
  structureDef: StructureDefinition,
  complexTypeValidator: ComplexTypeValidator,
): Promise<ValidationIssue[]> {
  const path = elementDef.path;
  const validationTargets = getValidationTargets(resource, path);
  if (validationTargets.length === 0) {
    const value = getValueAtPath(resource, path);
    const directValue = getDirectValue(resource, path);
    const isEmptyArray = Array.isArray(directValue) && directValue.length === 0;
    if (value === undefined || value === null || isEmptyArray) {
      return shouldValidateRequired(resource, path)
        ? [buildMissingRequiredIssue(path, profileUrl)]
        : [];
    }
    return complexTypeValidator.validateComplexTypeSubElements(
      value,
      elementDef,
      path,
      profileUrl,
      structureDef,
      fhirVersion,
    );
  }

  const issues: ValidationIssue[] = [];
  for (const target of validationTargets) {
    if (target.value === undefined || target.value === null) {
      if (shouldValidateRequired(resource, target.contextPath)) {
        issues.push(buildMissingRequiredIssue(target.fullPath, profileUrl));
      }
      continue;
    }
    issues.push(...await complexTypeValidator.validateComplexTypeSubElements(
      target.value,
      elementDef,
      target.fullPath,
      profileUrl,
      structureDef,
      fhirVersion,
    ));
  }
  return issues;
}

function isElementDefinition(value: unknown): value is ElementDefinition {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string';
}

function getResourceType(resource: unknown): string {
  if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) {
    return '';
  }
  const resourceType = (resource as Record<string, unknown>).resourceType;
  return typeof resourceType === 'string' ? resourceType : '';
}
