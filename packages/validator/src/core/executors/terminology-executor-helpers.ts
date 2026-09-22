import { createValidationIssue } from '../../issues/index.js';
import { logger } from '../../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { getErrorMessage } from '../../utils/error-utils.js';
import {
  createSafeValidationFailureMessage,
  validationFailureMetadata,
} from '../../utils/validation-execution-failure.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDirectResourceElementPath(path: string, resourceType?: string): boolean {
  if (!resourceType) return false;
  const normalizedPath = path.replace(/\[[^\]]+\]/g, '');
  const segments = normalizedPath.split('.').filter(Boolean);
  return segments.length === 2 && segments[0] === resourceType;
}

export function isUsableElementDefinition(value: unknown): value is ElementDefinition {
  return isRecord(value) && typeof value.path === 'string' && value.path.length > 0;
}

export function getElementTypeCodes(elementDef: ElementDefinition): string[] {
  if (!Array.isArray(elementDef.type)) return [];
  return elementDef.type.flatMap(type => {
    const record = isRecord(type) ? type : undefined;
    return typeof record?.code === 'string' ? [record.code] : [];
  });
}

export function getResourceType(
  resource: unknown,
  structureDef: StructureDefinition,
): string {
  const resourceType = isRecord(resource) ? resource.resourceType : undefined;
  if (typeof resourceType === 'string' && resourceType.length > 0) return resourceType;
  return typeof structureDef.type === 'string' && structureDef.type.length > 0
    ? structureDef.type
    : 'Resource';
}

export function appendTerminologyFailure(
  issues: ValidationIssue[],
  failureMessages: Set<string>,
  error: unknown,
  resource: unknown,
  structureDef: StructureDefinition,
  profileUrl?: string,
  fieldPath?: string,
): void {
  const errorMessage = getErrorMessage(error);
  if (failureMessages.has(errorMessage)) return;
  failureMessages.add(errorMessage);
  logger.error(
    '[TerminologyExecutor] Terminology validation failed',
    validationFailureMetadata(error),
  );
  issues.push(createValidationIssue({
    code: 'validation-error',
    path: fieldPath ?? '',
    resourceType: getResourceType(resource, structureDef),
    profile: profileUrl,
    aspectOverride: 'terminology',
    severityOverride: 'error',
    customMessage: createSafeValidationFailureMessage('Terminology validation'),
  }));
}
