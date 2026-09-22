import type { ValidationIssue } from '@records-fhir/validation-types';
import { differenceInDays } from 'date-fns';
import {
  asRecord,
  createBusinessRuleIssue,
  displayValue,
  getPresentProperty,
  getResourceType,
  parseFhirDateTime,
  type UnknownRecord,
} from './validator-utils.js';

const ONSET_DATE_RULE = 'condition-onset-date-validation';

export async function validateConditionOnsetDate(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  if (!resource) return [];

  const candidate = getOnsetDateCandidate(resource);
  if (!candidate) return [];

  const resourceType = getResourceType(resource, fallbackResourceType);
  const onsetDateTime = parseFhirDateTime(candidate.value);
  if (!onsetDateTime) {
    return [createBusinessRuleIssue({
      code: 'invalid-onset-date',
      path: candidate.path,
      resourceType,
      ruleId: ONSET_DATE_RULE,
      severity: 'error',
      messageParams: { date: displayValue(candidate.value) },
      details: { actualValue: candidate.value },
    })];
  }

  const daysDiff = differenceInDays(new Date(), onsetDateTime);
  return daysDiff < -1
    ? [createBusinessRuleIssue({
      code: 'future-onset-date',
      path: candidate.path,
      resourceType,
      ruleId: ONSET_DATE_RULE,
      severity: 'warning',
      messageParams: { date: candidate.value },
      details: { actualValue: candidate.value, daysInFuture: Math.abs(daysDiff) },
    })]
    : [];
}

export async function validateConditionStatusDateConsistency(
  _resource: unknown,
  _resourceType: string,
): Promise<ValidationIssue[]> {
  return [];
}

function getOnsetDateCandidate(
  resource: UnknownRecord,
): { value: unknown; path: string } | null {
  const dateTime = getPresentProperty(resource, 'onsetDateTime');
  if (dateTime !== undefined) return { value: dateTime, path: 'onsetDateTime' };

  const period = asRecord(resource.onsetPeriod);
  const start = period ? getPresentProperty(period, 'start') : undefined;
  return start !== undefined ? { value: start, path: 'onsetPeriod.start' } : null;
}
