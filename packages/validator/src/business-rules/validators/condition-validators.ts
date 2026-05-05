/**
 * Condition Business Rule Validators
 * 
 * Validators for Condition resource business rules.
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

export async function validateConditionOnsetDate(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const onsetDate = resource.onsetDateTime || resource.onsetPeriod?.start;
  if (!onsetDate) {
    return issues; // No onset date to validate
  }

  try {
    const onsetDateTime = parseFhirDateTime(onsetDate);

    if (!onsetDateTime) {
      issues.push({
        id: `condition-invalid-onset-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'error',
        code: 'invalid-onset-date',
        message: `Invalid onset date format: ${onsetDate}`,
        path: resource.onsetDateTime ? 'onsetDateTime' : 'onsetPeriod.start',
        humanReadable: 'The condition onset date format is invalid',
        details: {
          fieldPath: resource.onsetDateTime ? 'onsetDateTime' : 'onsetPeriod.start',
          actualValue: onsetDate,
          resourceType: resourceType,
          validationType: 'condition-onset-date-validation'
        },
        validationMethod: 'condition-onset-date-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
      return issues;
    }

    const now = new Date();
    const daysDiff = differenceInDays(now, onsetDateTime);

    // Check for future onset dates
    if (daysDiff < -1) { // Allow 1 day in future for rounding
      issues.push({
        id: `condition-future-onset-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'warning',
        code: 'future-onset-date',
        message: `Condition onset date is in the future: ${onsetDate}`,
        path: resource.onsetDateTime ? 'onsetDateTime' : 'onsetPeriod.start',
        humanReadable: 'The condition onset date is in the future',
        details: {
          fieldPath: resource.onsetDateTime ? 'onsetDateTime' : 'onsetPeriod.start',
          actualValue: onsetDate,
          daysInFuture: Math.abs(daysDiff),
          resourceType: resourceType,
          validationType: 'condition-onset-date-validation'
        },
        validationMethod: 'condition-onset-date-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }
  } catch (error: unknown) {
    logger.error('[ConditionValidators] Condition onset date validation failed:', error);
  }

  return issues;
}

export async function validateConditionStatusDateConsistency(_resource: any, _resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // This is a placeholder for more complex status-date consistency rules

  return issues;
}

