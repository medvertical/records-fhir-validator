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

const VALUE_RANGE_RULE = 'observation-value-range-validation';
const EFFECTIVE_DATE_RULE = 'observation-effective-date-validation';
const STATUS_VALUE_RULE = 'observation-status-value-consistency';
const VALUE_PROPERTIES = [
  'valueQuantity',
  'valueCodeableConcept',
  'valueString',
  'valueBoolean',
  'valueInteger',
  'valueRange',
  'valueRatio',
  'valueSampledData',
  'valueTime',
  'valueDateTime',
  'valuePeriod',
] as const;

export async function validateObservationValueRange(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  const quantity = resource ? asRecord(resource.valueQuantity) : null;
  if (!resource || !quantity) return [];

  const value = quantity.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return [];

  const unit = typeof quantity.unit === 'string'
    ? quantity.unit
    : typeof quantity.code === 'string' ? quantity.code : undefined;
  const code = getFirstCodingCode(resource.code);
  const resourceType = getResourceType(resource, fallbackResourceType);
  const range = getExpectedRange(code, unit);

  if (range && (value < range.min || value > range.max)) {
    return [createRangeIssue({
      value,
      unit,
      code,
      resourceType,
      min: range.min,
      max: range.max,
      label: range.label,
    })];
  }
  if (!range && value < 0 && !isWeightUnit(unit)) {
    return [createBusinessRuleIssue({
      code: 'negative-value',
      path: 'valueQuantity.value',
      resourceType,
      ruleId: VALUE_RANGE_RULE,
      severity: 'warning',
      messageParams: { value },
      details: { actualValue: value, unit, code },
    })];
  }
  return [];
}

export async function validateObservationEffectiveDate(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  if (!resource) return [];

  const candidate = getEffectiveDateCandidate(resource);
  if (!candidate) return [];

  const resourceType = getResourceType(resource, fallbackResourceType);
  const effectiveDateTime = parseFhirDateTime(candidate.value);
  if (!effectiveDateTime) {
    return [createBusinessRuleIssue({
      code: 'invalid-effective-date',
      path: candidate.path,
      resourceType,
      ruleId: EFFECTIVE_DATE_RULE,
      severity: 'error',
      messageParams: { date: displayValue(candidate.value) },
      details: { actualValue: candidate.value },
    })];
  }

  const daysDiff = differenceInDays(new Date(), effectiveDateTime);
  return daysDiff < -1
    ? [createBusinessRuleIssue({
      code: 'future-effective-date',
      path: candidate.path,
      resourceType,
      ruleId: EFFECTIVE_DATE_RULE,
      severity: 'warning',
      messageParams: { date: candidate.value },
      details: { actualValue: candidate.value, daysInFuture: Math.abs(daysDiff) },
    })]
    : [];
}

export async function validateObservationStatusValueConsistency(
  input: unknown,
  fallbackResourceType: string,
): Promise<ValidationIssue[]> {
  const resource = asRecord(input);
  if (!resource || resource.status !== 'final' || hasObservationValue(resource)) {
    return [];
  }

  return [createBusinessRuleIssue({
    code: 'final-status-no-value',
    path: 'status',
    resourceType: getResourceType(resource, fallbackResourceType),
    ruleId: STATUS_VALUE_RULE,
    severity: 'warning',
    details: { actualValue: resource.status },
  })];
}

function getEffectiveDateCandidate(
  resource: UnknownRecord,
): { value: unknown; path: string } | null {
  const dateTime = getPresentProperty(resource, 'effectiveDateTime');
  if (dateTime !== undefined) return { value: dateTime, path: 'effectiveDateTime' };

  const period = asRecord(resource.effectivePeriod);
  const start = period ? getPresentProperty(period, 'start') : undefined;
  return start !== undefined ? { value: start, path: 'effectivePeriod.start' } : null;
}

function getFirstCodingCode(value: unknown): string | undefined {
  const codeableConcept = asRecord(value);
  if (!codeableConcept || !Array.isArray(codeableConcept.coding)) return undefined;
  for (const candidate of codeableConcept.coding) {
    const coding = asRecord(candidate);
    if (coding && typeof coding.code === 'string' && coding.code.length > 0) {
      return coding.code;
    }
  }
  return undefined;
}

function getExpectedRange(
  code: string | undefined,
  unit: string | undefined,
): { min: number; max: number; label: string } | null {
  if (code === '85354-9' && unit === 'mm[Hg]') {
    return { min: 50, max: 300, label: 'blood pressure' };
  }
  if (code === '8867-4' && unit === '/min') {
    return { min: 30, max: 300, label: 'heart rate' };
  }
  if (unit === 'Cel' || unit === 'degC') {
    return { min: 25, max: 45, label: 'temperature' };
  }
  return null;
}

function createRangeIssue(input: {
  value: number;
  unit?: string;
  code?: string;
  resourceType: string;
  min: number;
  max: number;
  label: string;
}): ValidationIssue {
  const unitSuffix = input.unit ? ` ${input.unit}` : '';
  return createBusinessRuleIssue({
    code: 'value-out-of-range',
    path: 'valueQuantity.value',
    resourceType: input.resourceType,
    ruleId: VALUE_RANGE_RULE,
    severity: 'warning',
    customMessage:
      `${input.label} value ${input.value}${unitSuffix} is outside the expected range `
      + `(${input.min}-${input.max}${unitSuffix})`,
    messageParams: { value: input.value, min: input.min, max: input.max },
    details: {
      actualValue: input.value,
      unit: input.unit,
      expectedRange: `${input.min}-${input.max}${unitSuffix}`,
      code: input.code,
    },
  });
}

function isWeightUnit(unit: string | undefined): boolean {
  return unit === 'kg' || unit === 'g' || unit === 'mg';
}

function hasObservationValue(observation: UnknownRecord): boolean {
  if (hasValueX(observation) || asRecord(observation.dataAbsentReason)) return true;
  if (!Array.isArray(observation.component)) return false;
  return observation.component.some(candidate => {
    const component = asRecord(candidate);
    return component !== null
      && (hasValueX(component) || asRecord(component.dataAbsentReason) !== null);
  });
}

function hasValueX(element: UnknownRecord): boolean {
  return VALUE_PROPERTIES.some(property =>
    element[property] !== undefined && element[property] !== null
  );
}
