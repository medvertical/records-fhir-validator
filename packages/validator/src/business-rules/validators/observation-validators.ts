/**
 * Observation Business Rule Validators
 * 
 * Validators for Observation resource business rules.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { parseISO, isValid, differenceInDays } from 'date-fns';
import { logger } from '../../logger';

/**
 * Parse FHIR datetime string to Date
 * Handles partial dates (YYYY, YYYY-MM, YYYY-MM-DD) and full datetimes
 */
function parseFhirDateTime(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try parsing as ISO first (handles full datetimes)
  let date = parseISO(dateStr);
  if (isValid(date)) return date;

  // Try parsing partial dates
  if (/^\d{4}$/.test(dateStr)) {
    date = new Date(parseInt(dateStr, 10), 0, 1);
  } else if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split('-').map(Number);
    date = new Date(year, month - 1, 1);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-').map(Number);
    date = new Date(year, month - 1, day);
  }

  return isValid(date) ? date : null;
}

export async function validateObservationValueRange(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Check valueQuantity
  if (resource.valueQuantity) {
    const value = resource.valueQuantity.value;
    const unit = resource.valueQuantity.unit;
    const code = resource.code?.coding?.[0]?.code;

    if (typeof value === 'number') {
      // Blood pressure validation
      if (code === '85354-9' && unit === 'mm[Hg]') { // Blood pressure
        if (value < 50 || value > 300) {
          issues.push({
            id: `observation-blood-pressure-range-${Date.now()}`,
            aspect: 'business-rules',
            severity: 'warning',
            code: 'value-out-of-range',
            message: `Blood pressure value ${value} ${unit} is outside normal range (50-300 mmHg)`,
            path: 'valueQuantity.value',
            humanReadable: `Blood pressure value of ${value} ${unit} is outside the normal range`,
            details: {
              fieldPath: 'valueQuantity.value',
              actualValue: value,
              unit: unit,
              expectedRange: '50-300 mmHg',
              code: code,
              resourceType: resourceType,
              validationType: 'observation-value-range-validation'
            },
            validationMethod: 'observation-value-range-validation',
            timestamp: new Date().toISOString(),
            resourceType: resourceType,
            schemaVersion: 'R4'
          });
        }
      }
      // Heart rate validation
      else if (code === '8867-4' && unit === '/min') { // Heart rate
        if (value < 30 || value > 300) {
          issues.push({
            id: `observation-heart-rate-range-${Date.now()}`,
            aspect: 'business-rules',
            severity: 'warning',
            code: 'value-out-of-range',
            message: `Heart rate value ${value} ${unit} is outside normal range (30-300 /min)`,
            path: 'valueQuantity.value',
            humanReadable: `Heart rate value of ${value} ${unit} is outside the normal range`,
            details: {
              fieldPath: 'valueQuantity.value',
              actualValue: value,
              unit: unit,
              expectedRange: '30-300 /min',
              code: code,
              resourceType: resourceType,
              validationType: 'observation-value-range-validation'
            },
            validationMethod: 'observation-value-range-validation',
            timestamp: new Date().toISOString(),
            resourceType: resourceType,
            schemaVersion: 'R4'
          });
        }
      }
      // Temperature validation
      else if (unit === 'Cel' || unit === 'degC') { // Temperature in Celsius
        if (value < 25 || value > 45) {
          issues.push({
            id: `observation-temperature-range-${Date.now()}`,
            aspect: 'business-rules',
            severity: 'warning',
            code: 'value-out-of-range',
            message: `Temperature value ${value} ${unit} is outside normal range (25-45°C)`,
            path: 'valueQuantity.value',
            humanReadable: `Temperature value of ${value} ${unit} is outside the normal range`,
            details: {
              fieldPath: 'valueQuantity.value',
              actualValue: value,
              unit: unit,
              expectedRange: '25-45°C',
              code: code,
              resourceType: resourceType,
              validationType: 'observation-value-range-validation'
            },
            validationMethod: 'observation-value-range-validation',
            timestamp: new Date().toISOString(),
            resourceType: resourceType,
            schemaVersion: 'R4'
          });
        }
      }
      // Generic negative value validation
      else if (value < 0 && unit !== 'kg' && unit !== 'g' && unit !== 'mg') { // Negative values (except weights)
        issues.push({
          id: `observation-negative-value-${Date.now()}`,
          aspect: 'business-rules',
          severity: 'warning',
          code: 'negative-value',
          message: `Observation value ${value} ${unit} is negative`,
          path: 'valueQuantity.value',
          humanReadable: `Observation value of ${value} ${unit} is negative, which may be unusual`,
          details: {
            fieldPath: 'valueQuantity.value',
            actualValue: value,
            unit: unit,
            code: code,
            resourceType: resourceType,
            validationType: 'observation-value-range-validation'
          },
          validationMethod: 'observation-value-range-validation',
          timestamp: new Date().toISOString(),
          resourceType: resourceType,
          schemaVersion: 'R4'
        });
      }
    }
  }

  return issues;
}

export async function validateObservationEffectiveDate(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const effectiveDate = resource.effectiveDateTime || resource.effectivePeriod?.start;
  if (!effectiveDate) {
    return issues; // No effective date to validate
  }

  try {
    const effectiveDateTime = parseFhirDateTime(effectiveDate);

    if (!effectiveDateTime) {
      issues.push({
        id: `observation-invalid-effective-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'error',
        code: 'invalid-effective-date',
        message: `Invalid effective date format: ${effectiveDate}`,
        path: resource.effectiveDateTime ? 'effectiveDateTime' : 'effectivePeriod.start',
        humanReadable: 'The observation effective date format is invalid',
        details: {
          fieldPath: resource.effectiveDateTime ? 'effectiveDateTime' : 'effectivePeriod.start',
          actualValue: effectiveDate,
          resourceType: resourceType,
          validationType: 'observation-effective-date-validation'
        },
        validationMethod: 'observation-effective-date-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
      return issues;
    }

    const now = new Date();
    const daysDiff = differenceInDays(now, effectiveDateTime);

    // Check for future effective dates
    if (daysDiff < -1) { // Allow 1 day in future for rounding
      issues.push({
        id: `observation-future-effective-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'warning',
        code: 'future-effective-date',
        message: `Observation effective date is in the future: ${effectiveDate}`,
        path: resource.effectiveDateTime ? 'effectiveDateTime' : 'effectivePeriod.start',
        humanReadable: 'The observation effective date is in the future',
        details: {
          fieldPath: resource.effectiveDateTime ? 'effectiveDateTime' : 'effectivePeriod.start',
          actualValue: effectiveDate,
          daysInFuture: Math.abs(daysDiff),
          resourceType: resourceType,
          validationType: 'observation-effective-date-validation'
        },
        validationMethod: 'observation-effective-date-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }
  } catch (error: unknown) {
    logger.error('[ObservationValidators] Observation effective date validation failed:', error);
  }

  return issues;
}

export async function validateObservationStatusValueConsistency(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const hasValue = hasObservationValue(resource);

  if (resource.status === 'final' && !hasValue) {
    issues.push({
      id: `observation-final-no-value-${Date.now()}`,
      aspect: 'business-rules',
      severity: 'warning',
      code: 'final-status-no-value',
      message: 'Observation has final status but no value',
      path: 'status',
      humanReadable: 'An observation with final status should have a value',
      details: {
        fieldPath: 'status',
        actualValue: resource.status,
        resourceType: resourceType,
        validationType: 'observation-status-value-consistency'
      },
      validationMethod: 'observation-status-value-consistency',
      timestamp: new Date().toISOString(),
      resourceType: resourceType,
      schemaVersion: 'R4'
    });
  }

  return issues;
}

function hasObservationValue(observation: any): boolean {
  if (hasValueX(observation) || observation.dataAbsentReason) {
    return true;
  }

  return Array.isArray(observation.component) && observation.component.some((component: any) =>
    hasValueX(component) || component.dataAbsentReason
  );
}

function hasValueX(element: any): boolean {
  return !!(
    element.valueQuantity ||
    element.valueCodeableConcept ||
    element.valueString ||
    element.valueBoolean ||
    element.valueInteger ||
    element.valueRange ||
    element.valueRatio ||
    element.valueSampledData ||
    element.valueTime ||
    element.valueDateTime ||
    element.valuePeriod
  );
}
