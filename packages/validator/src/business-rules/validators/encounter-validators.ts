/**
 * Encounter Business Rule Validators
 * 
 * Validators for Encounter resource business rules.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { parseISO, isValid, isBefore } from 'date-fns';
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

export async function validateEncounterPeriod(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!resource.period) {
    return issues; // No period to validate
  }

  try {
    // Only validate start if it exists (don't validate ghost items)
    let startDate: Date | null = null;
    if (resource.period.start != null && resource.period.start !== '') {
      startDate = parseFhirDateTime(resource.period.start);
      if (!startDate) {
        issues.push({
          id: `encounter-invalid-period-start-${Date.now()}`,
          aspect: 'invariant',
          severity: 'error',
          code: 'invalid-period-start',
          message: `Invalid encounter period start: ${resource.period.start}`,
          path: 'period.start',
          humanReadable: 'The encounter period start date format is invalid',
          details: {
            fieldPath: 'period.start',
            actualValue: resource.period.start,
            resourceType: resourceType,
            validationType: 'encounter-period-validation'
          },
          validationMethod: 'encounter-period-validation',
          timestamp: new Date().toISOString(),
          resourceType: resourceType,
          schemaVersion: 'R4'
        });
      }
    }

    // Only validate end if it exists (it's optional - don't validate ghost items)
    let endDate: Date | null = null;
    if (resource.period.end != null && resource.period.end !== '') {
      endDate = parseFhirDateTime(resource.period.end);
      if (!endDate) {
        issues.push({
          id: `encounter-invalid-period-end-${Date.now()}`,
          aspect: 'invariant',
          severity: 'error',
          code: 'invalid-period-end',
          message: `Invalid encounter period end: ${resource.period.end}`,
          path: 'period.end',
          humanReadable: 'The encounter period end date format is invalid',
          details: {
            fieldPath: 'period.end',
            actualValue: resource.period.end,
            resourceType: resourceType,
            validationType: 'encounter-period-validation'
          },
          validationMethod: 'encounter-period-validation',
          timestamp: new Date().toISOString(),
          resourceType: resourceType,
          schemaVersion: 'R4'
        });
      }
    }

    // Only compare if both exist and are valid
    if (startDate && endDate && isBefore(endDate, startDate)) {
      issues.push({
        id: `encounter-end-before-start-${Date.now()}`,
        aspect: 'invariant',
        severity: 'error',
        code: 'end-before-start',
        message: `Encounter period end is before start: ${resource.period.end} < ${resource.period.start}`,
        path: 'period',
        humanReadable: 'The encounter period end date is before the start date',
        details: {
          fieldPath: 'period',
          startValue: resource.period.start,
          endValue: resource.period.end,
          resourceType: resourceType,
          validationType: 'encounter-period-validation'
        },
        validationMethod: 'encounter-period-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }
  } catch (error: unknown) {
    logger.error('[EncounterValidators] Encounter period validation failed:', error);
  }

  return issues;
}

export async function validateEncounterStatusPeriodConsistency(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Check if encounter has finished status but no end period
  if (resource.status === 'finished' && (!resource.period || !resource.period.end)) {
    issues.push({
      id: `encounter-finished-no-end-${Date.now()}`,
      aspect: 'invariant',
      severity: 'warning',
      code: 'finished-status-no-end',
      message: 'Encounter has finished status but no end period',
      path: 'status',
      humanReadable: 'An encounter with finished status should have an end period',
      details: {
        fieldPath: 'status',
        actualValue: resource.status,
        resourceType: resourceType,
        validationType: 'encounter-status-period-consistency'
      },
      validationMethod: 'encounter-status-period-consistency',
      timestamp: new Date().toISOString(),
      resourceType: resourceType,
      schemaVersion: 'R4'
    });
  }

  return issues;
}

