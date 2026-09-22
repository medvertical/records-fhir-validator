import type {
  ValidationIssue,
  ValidationSeverity,
} from '@records-fhir/validation-types';
import { isValid, parseISO } from 'date-fns';
import { createValidationIssue } from '../../issues/index.js';

export type UnknownRecord = Record<string, unknown>;

export interface BusinessRuleIssueInput {
  code: string;
  path: string;
  resourceType: string;
  ruleId: string;
  severity?: ValidationSeverity;
  messageParams?: Record<string, unknown>;
  details?: Record<string, unknown>;
  customMessage?: string;
}

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function getResourceType(
  resource: UnknownRecord,
  fallback: string,
): string {
  return typeof resource.resourceType === 'string' && resource.resourceType.length > 0
    ? resource.resourceType
    : fallback;
}

export function getPresentProperty(
  record: UnknownRecord,
  property: string,
): unknown | undefined {
  const value = record[property];
  return value !== undefined && value !== null && value !== '' ? value : undefined;
}

export function parseFhirDateTime(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable value]';
  }
}

export function createBusinessRuleIssue(
  input: BusinessRuleIssueInput,
): ValidationIssue {
  return createValidationIssue({
    code: input.code,
    path: input.path,
    resourceType: input.resourceType,
    ruleId: input.ruleId,
    severityOverride: input.severity,
    customMessage: input.customMessage,
    messageParams: input.messageParams,
    details: {
      businessRule: input.ruleId,
      ...input.details,
    },
  });
}
