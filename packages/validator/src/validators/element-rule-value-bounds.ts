import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

export function validateElementValueBounds(
  value: unknown,
  elementAny: Record<string, unknown>,
  path: string,
  profileUrl?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const minValueKeys = Object.keys(elementAny).filter((key) => key.startsWith('minValue'));
  for (const minValueKey of minValueKeys) {
    const minimum = elementAny[minValueKey];
    const comparison = compareOrderedValues(value, minimum, minValueKey, 'min');
    if (comparison !== undefined && comparison < 0) {
      issues.push(createValidationIssue({
        code: isRelativeDurationConstraint(value, minimum, minValueKey) ?
          'profile-min-value-duration-violation' :
          'profile-min-value-violation',
        path,
        resourceType: 'Unknown',
        profile: profileUrl,
        customMessage: `Value ${formatValue(value)} is less than minimum ${formatValue(minimum)}`,
        severityOverride: 'error',
      }));
    }
  }

  const maxValueKeys = Object.keys(elementAny).filter((key) => key.startsWith('maxValue'));
  for (const maxValueKey of maxValueKeys) {
    const maximum = elementAny[maxValueKey];
    const comparison = compareOrderedValues(value, maximum, maxValueKey, 'max');
    if (comparison !== undefined && comparison > 0) {
      issues.push(createValidationIssue({
        code: isRelativeDurationConstraint(value, maximum, maxValueKey) ?
          'profile-max-value-duration-violation' :
          'profile-max-value-violation',
        path,
        resourceType: 'Unknown',
        profile: profileUrl,
        customMessage: `Value ${formatValue(value)} is greater than maximum ${formatValue(maximum)}`,
        severityOverride: 'error',
      }));
    }
  }

  return issues;
}

function compareOrderedValues(
  actual: unknown,
  bound: unknown,
  constraintKey: string,
  direction: 'min' | 'max'
): number | undefined {
  if (actual === undefined || actual === null || bound === undefined || bound === null) {
    return undefined;
  }

  const relativeDurationBoundary = getRelativeDurationBoundary(actual, bound, constraintKey, direction);
  if (relativeDurationBoundary !== undefined) {
    const actualTemporal = toComparableValue(actual);
    if (actualTemporal === undefined) {
      return undefined;
    }

    if (actualTemporal < relativeDurationBoundary) return -1;
    if (actualTemporal > relativeDurationBoundary) return 1;
    return 0;
  }

  if (areQuantityLike(actual) || areQuantityLike(bound)) {
    if (!areQuantityLike(actual) || !areQuantityLike(bound)) {
      return undefined;
    }

    if (!haveCompatibleQuantityUnits(actual, bound)) {
      return undefined;
    }

    const actualQuantityComparable = toComparableQuantityValue(actual);
    const boundQuantityComparable = toComparableQuantityValue(bound);

    if (actualQuantityComparable === undefined || boundQuantityComparable === undefined) {
      return undefined;
    }

    if (actualQuantityComparable < boundQuantityComparable) return -1;
    if (actualQuantityComparable > boundQuantityComparable) return 1;
    return 0;
  }

  const actualComparable = toComparableValue(actual);
  const boundComparable = toComparableValue(bound);

  if (actualComparable === undefined || boundComparable === undefined) {
    return undefined;
  }

  if (actualComparable < boundComparable) return -1;
  if (actualComparable > boundComparable) return 1;
  return 0;
}

function isRelativeDurationConstraint(
  actual: unknown,
  bound: unknown,
  constraintKey: string,
): bound is Record<string, unknown> {
  return typeof actual === 'string' && constraintKey.endsWith('Duration') && areQuantityLike(bound);
}

function getRelativeDurationBoundary(
  actual: unknown,
  duration: unknown,
  constraintKey: string,
  direction: 'min' | 'max'
): number | undefined {
  if (!isRelativeDurationConstraint(actual, duration, constraintKey)) {
    return undefined;
  }

  const boundary = addDurationToDate(new Date(), duration, direction === 'min' ? -1 : 1);
  return boundary?.getTime();
}

function addDurationToDate(
  date: Date,
  duration: Record<string, unknown>,
  sign: 1 | -1,
): Date | undefined {
  if (typeof duration.value !== 'number' || !Number.isFinite(duration.value)) {
    return undefined;
  }

  const code = duration.code ?? duration.unit;
  const result = new Date(date.getTime());
  const amount = duration.value * sign;

  switch (code) {
    case 'a':
    case 'year':
    case 'years':
      result.setFullYear(result.getFullYear() + amount);
      return result;
    case 'mo':
    case 'month':
    case 'months':
      result.setMonth(result.getMonth() + amount);
      return result;
    case 'wk':
    case 'week':
    case 'weeks':
      result.setDate(result.getDate() + amount * 7);
      return result;
    case 'd':
    case 'day':
    case 'days':
      result.setDate(result.getDate() + amount);
      return result;
    case 'h':
    case 'hour':
    case 'hours':
      result.setHours(result.getHours() + amount);
      return result;
    case 'min':
    case 'minute':
    case 'minutes':
      result.setMinutes(result.getMinutes() + amount);
      return result;
    case 's':
    case 'second':
    case 'seconds':
      result.setSeconds(result.getSeconds() + amount);
      return result;
    default:
      return undefined;
  }
}

function toComparableValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    return parseTemporalValue(value);
  }

  if (isObjectRecord(value) && typeof value.value === 'number') {
    return Number.isFinite(value.value) ? value.value : undefined;
  }

  return undefined;
}

function parseTemporalValue(value: string): number | undefined {
  if (/^\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?$/.test(value)) {
    const [hours, minutes, seconds = '0'] = value.split(':');
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }

  let normalized = value;
  if (/^\d{4}$/.test(value)) {
    normalized = `${value}-01-01T00:00:00Z`;
  } else if (/^\d{4}-\d{2}$/.test(value)) {
    normalized = `${value}-01T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    normalized = `${value}T00:00:00Z`;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function areQuantityLike(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && 'value' in value;
}

function haveCompatibleQuantityUnits(actual: unknown, bound: unknown): boolean {
  if (!areQuantityLike(actual) || !areQuantityLike(bound)) {
    return true;
  }

  const actualSystem = actual.system;
  const boundSystem = bound.system;
  if (actualSystem !== undefined && boundSystem !== undefined && actualSystem !== boundSystem) {
    return false;
  }

  const actualCode = actual.code ?? actual.unit;
  const boundCode = bound.code ?? bound.unit;
  if (actualCode !== undefined && boundCode !== undefined) {
    if (actualCode === boundCode) {
      return true;
    }

    const normalizedActual = normalizeUcumQuantity(actual);
    const normalizedBound = normalizeUcumQuantity(bound);
    return Boolean(
      normalizedActual &&
      normalizedBound &&
      normalizedActual.dimension === normalizedBound.dimension
    );
  }

  return true;
}

function toComparableQuantityValue(value: unknown): number | undefined {
  if (!areQuantityLike(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    return undefined;
  }

  return normalizeUcumQuantity(value)?.value ?? value.value;
}

function normalizeUcumQuantity(
  value: Record<string, unknown>,
): { dimension: string; value: number } | undefined {
  if (value.system !== 'http://unitsofmeasure.org') {
    return undefined;
  }

  const code = value.code ?? value.unit;
  const massFactorToGram: Record<string, number> = {
    kg: 1000,
    g: 1,
    mg: 0.001,
    ug: 0.000001,
    ng: 0.000000001,
  };

  if (typeof code === 'string' &&
      code in massFactorToGram &&
      typeof value.value === 'number') {
    return {
      dimension: 'mass-g',
      value: value.value * massFactorToGram[code],
    };
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}
