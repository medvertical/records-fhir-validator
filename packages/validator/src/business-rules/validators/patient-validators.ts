import type { ValidationIssue } from '@records-fhir/validation-types';
import { differenceInYears } from 'date-fns';
import {
  asRecord,
  createBusinessRuleIssue,
  displayValue,
  getPresentProperty,
  getResourceType,
  parseFhirDateTime,
} from './validator-utils.js';

const RULE_ID = 'patient-age-validation';

export async function validatePatientAge(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  if (!resource) return [];

  const birthDateValue = getPresentProperty(resource, 'birthDate');
  if (birthDateValue === undefined) return [];

  const resourceType = getResourceType(resource, fallbackResourceType);
  const birthDate = parseFhirDateTime(birthDateValue);
  if (!birthDate) {
    return [createBusinessRuleIssue({
      code: 'invalid-birth-date',
      path: 'birthDate',
      resourceType,
      ruleId: RULE_ID,
      severity: 'error',
      messageParams: { date: displayValue(birthDateValue) },
      details: { actualValue: birthDateValue },
    })];
  }

  const ageInYears = differenceInYears(new Date(), birthDate);
  if (ageInYears < 0) {
    return [createBusinessRuleIssue({
      code: 'future-birth-date',
      path: 'birthDate',
      resourceType,
      ruleId: RULE_ID,
      severity: 'error',
      messageParams: { date: birthDateValue },
      details: { actualValue: birthDateValue, ageInYears },
    })];
  }
  if (ageInYears > 150) {
    return [createBusinessRuleIssue({
      code: 'unreasonable-age',
      path: 'birthDate',
      resourceType,
      ruleId: RULE_ID,
      severity: 'warning',
      messageParams: { age: ageInYears },
      details: { actualValue: birthDateValue, ageInYears },
    })];
  }
  return [];
}
