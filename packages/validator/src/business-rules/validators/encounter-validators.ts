import type { ValidationIssue } from '@records-fhir/validation-types';
import { isBefore } from 'date-fns';
import {
  asRecord,
  createBusinessRuleIssue,
  displayValue,
  getPresentProperty,
  getResourceType,
  parseFhirDateTime,
} from './validator-utils.js';

const PERIOD_RULE = 'encounter-period-validation';
const STATUS_PERIOD_RULE = 'encounter-status-period-consistency';

export async function validateEncounterPeriod(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  const period = resource ? asRecord(resource.period) : null;
  if (!resource || !period) return [];

  const resourceType = getResourceType(resource, fallbackResourceType);
  const startValue = getPresentProperty(period, 'start');
  const endValue = getPresentProperty(period, 'end');
  const startDate = startValue === undefined ? null : parseFhirDateTime(startValue);
  const endDate = endValue === undefined ? null : parseFhirDateTime(endValue);
  const issues: ValidationIssue[] = [];

  if (startValue !== undefined && !startDate) {
    issues.push(createInvalidPeriodIssue(
      'start',
      startValue,
      resourceType,
    ));
  }
  if (endValue !== undefined && !endDate) {
    issues.push(createInvalidPeriodIssue(
      'end',
      endValue,
      resourceType,
    ));
  }
  if (startDate && endDate && isBefore(endDate, startDate)) {
    issues.push(createBusinessRuleIssue({
      code: 'end-before-start',
      path: 'period',
      resourceType,
      ruleId: PERIOD_RULE,
      severity: 'error',
      messageParams: { start: startValue, end: endValue },
      details: { startValue, endValue },
    }));
  }
  return issues;
}

export async function validateEncounterStatusPeriodConsistency(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  if (!resource || resource.status !== 'finished') return [];

  const period = asRecord(resource.period);
  if (period && getPresentProperty(period, 'end') !== undefined) return [];

  return [createBusinessRuleIssue({
    code: 'finished-status-no-end',
    path: 'status',
    resourceType: getResourceType(resource, fallbackResourceType),
    ruleId: STATUS_PERIOD_RULE,
    severity: 'warning',
    details: { actualValue: resource.status },
  })];
}

function createInvalidPeriodIssue(
  part: 'start' | 'end',
  value: unknown,
  resourceType: string,
): ValidationIssue {
  return createBusinessRuleIssue({
    code: `invalid-period-${part}`,
    path: `period.${part}`,
    resourceType,
    ruleId: PERIOD_RULE,
    severity: 'error',
    messageParams: { date: displayValue(value) },
    details: { actualValue: value },
  });
}
