/**
 * Business Rule Registry
 * 
 * Initializes and manages built-in business rules for different resource types.
 * Extracted from business-rule-validator.ts to reduce file size.
 */

import type { BusinessRule, BusinessRuleMap } from './business-rule-types';
import { BusinessRuleValidators } from './business-rule-validators';
import { logger } from '../logger';

export class RuleRegistry {
  private businessRules: BusinessRuleMap = new Map();
  private validators: BusinessRuleValidators;

  constructor() {
    this.validators = new BusinessRuleValidators();
    this.initializeBusinessRules();
  }

  /**
   * Initialize business rules for different resource types
   */
  private initializeBusinessRules(): void {
    // Patient business rules
    this.businessRules.set('Patient', [
      {
        name: 'patient-age-validation',
        description: 'Validate patient age is reasonable (birth date validation)',
        validator: this.validators.validatePatientAge.bind(this.validators)
      }
    ]);

    // Observation business rules
    this.businessRules.set('Observation', [
      {
        name: 'observation-value-range-validation',
        description: 'Validate observation values are within reasonable ranges',
        validator: this.validators.validateObservationValueRange.bind(this.validators)
      },
      {
        name: 'observation-effective-date-validation',
        description: 'Validate observation effective date is reasonable',
        validator: this.validators.validateObservationEffectiveDate.bind(this.validators)
      },
      {
        name: 'observation-status-value-consistency',
        description: 'Validate observation status and value consistency',
        validator: this.validators.validateObservationStatusValueConsistency.bind(this.validators)
      }
    ]);

    // Condition business rules
    this.businessRules.set('Condition', [
      {
        name: 'condition-onset-date-validation',
        description: 'Validate condition onset date is reasonable',
        validator: this.validators.validateConditionOnsetDate.bind(this.validators)
      },
      {
        name: 'condition-status-date-consistency',
        description: 'Validate condition status and date consistency',
        validator: this.validators.validateConditionStatusDateConsistency.bind(this.validators)
      }
    ]);

    // Encounter business rules
    this.businessRules.set('Encounter', [
      {
        name: 'encounter-period-validation',
        description: 'Validate encounter period is reasonable',
        validator: this.validators.validateEncounterPeriod.bind(this.validators)
      },
      {
        name: 'encounter-status-period-consistency',
        description: 'Validate encounter status and period consistency',
        validator: this.validators.validateEncounterStatusPeriodConsistency.bind(this.validators)
      }
    ]);

    logger.info(`[RuleRegistry] Initialized business rules for ${this.businessRules.size} FHIR R4 resource types`);
  }

  /**
   * Get business rules for a resource type
   */
  getRulesForResourceType(resourceType: string): BusinessRule[] {
    return this.businessRules.get(resourceType) || [];
  }

  /**
   * Get all registered resource types
   */
  getRegisteredResourceTypes(): string[] {
    return Array.from(this.businessRules.keys());
  }
}

