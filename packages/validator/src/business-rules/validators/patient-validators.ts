/**
 * Patient Business Rule Validators
 * 
 * Validators for Patient resource business rules.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { parse, isValid, differenceInYears } from 'date-fns';
import { logger } from '../../logger';

export async function validatePatientAge(resource: any, resourceType: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!resource.birthDate) {
    return issues; // No birth date to validate
  }

  try {
    // FHIR dates can be YYYY, YYYY-MM, or YYYY-MM-DD
    // Try parsing with different formats
    let birthDate: Date | null = null;
    const dateStr = resource.birthDate;

    if (/^\d{4}$/.test(dateStr)) {
      // Year only: YYYY
      birthDate = parse(dateStr, 'yyyy', new Date());
    } else if (/^\d{4}-\d{2}$/.test(dateStr)) {
      // Year-month: YYYY-MM
      birthDate = parse(dateStr, 'yyyy-MM', new Date());
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      // Full date: YYYY-MM-DD
      birthDate = parse(dateStr, 'yyyy-MM-dd', new Date());
    } else {
      // Try ISO format for datetime
      birthDate = new Date(dateStr);
    }

    if (!birthDate || !isValid(birthDate)) {
      issues.push({
        id: `patient-invalid-birth-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'error',
        code: 'invalid-birth-date',
        message: `Invalid birth date format: ${resource.birthDate}`,
        path: 'birthDate',
        humanReadable: 'The birth date format is invalid',
        details: {
          fieldPath: 'birthDate',
          actualValue: resource.birthDate,
          resourceType: resourceType,
          validationType: 'patient-age-validation'
        },
        validationMethod: 'patient-age-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
      return issues;
    }

    const now = new Date();
    const ageInYears = differenceInYears(now, birthDate);

    // Check for unreasonable ages
    if (ageInYears < 0) {
      issues.push({
        id: `patient-future-birth-date-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'error',
        code: 'future-birth-date',
        message: `Birth date is in the future: ${resource.birthDate}`,
        path: 'birthDate',
        humanReadable: 'The birth date cannot be in the future',
        details: {
          fieldPath: 'birthDate',
          actualValue: resource.birthDate,
          ageInYears: ageInYears,
          resourceType: resourceType,
          validationType: 'patient-age-validation'
        },
        validationMethod: 'patient-age-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    } else if (ageInYears > 150) {
      issues.push({
        id: `patient-unreasonable-age-${Date.now()}`,
        aspect: 'business-rules',
        severity: 'warning',
        code: 'unreasonable-age',
        message: `Patient age is unreasonable: ${ageInYears} years`,
        path: 'birthDate',
        humanReadable: `The patient age of ${ageInYears} years seems unreasonable`,
        details: {
          fieldPath: 'birthDate',
          actualValue: resource.birthDate,
          ageInYears: ageInYears,
          resourceType: resourceType,
          validationType: 'patient-age-validation'
        },
        validationMethod: 'patient-age-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }
  } catch (error: unknown) {
    logger.error('[PatientValidators] Patient age validation failed:', error);
  }

  return issues;
}

