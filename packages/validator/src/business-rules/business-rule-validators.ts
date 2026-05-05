/**
 * Business Rule Validators
 * 
 * Built-in business rule validators for different resource types.
 * Extracted from business-rule-validator.ts to reduce file size.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { validatePatientAge } from './validators/patient-validators';
import * as observationValidators from './validators/observation-validators';
import * as conditionValidators from './validators/condition-validators';
import * as encounterValidators from './validators/encounter-validators';

export class BusinessRuleValidators {
  async validatePatientAge(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return validatePatientAge(resource, resourceType);
  }

  async validateObservationValueRange(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return observationValidators.validateObservationValueRange(resource, resourceType);
  }

  async validateObservationEffectiveDate(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return observationValidators.validateObservationEffectiveDate(resource, resourceType);
  }

  async validateObservationStatusValueConsistency(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return observationValidators.validateObservationStatusValueConsistency(resource, resourceType);
  }

  async validateConditionOnsetDate(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return conditionValidators.validateConditionOnsetDate(resource, resourceType);
  }

  async validateConditionStatusDateConsistency(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return conditionValidators.validateConditionStatusDateConsistency(resource, resourceType);
  }

  async validateEncounterPeriod(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return encounterValidators.validateEncounterPeriod(resource, resourceType);
  }

  async validateEncounterStatusPeriodConsistency(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return encounterValidators.validateEncounterStatusPeriodConsistency(resource, resourceType);
  }
}
