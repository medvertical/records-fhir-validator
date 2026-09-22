/**
 * Business Rule Registry
 * 
 * Initializes and manages built-in business rules for different resource types.
 * Extracted from business-rule-validator.ts to reduce file size.
 */

import type { BusinessRule, BusinessRuleMap } from './business-rule-types.js';
import { logger } from '../logger.js';
import { validatePatientAge } from './validators/patient-validators.js';
import {
  validateObservationEffectiveDate,
  validateObservationStatusValueConsistency,
  validateObservationValueRange,
} from './validators/observation-validators.js';
import {
  validateConditionOnsetDate,
  validateConditionStatusDateConsistency,
} from './validators/condition-validators.js';
import {
  validateEncounterPeriod,
  validateEncounterStatusPeriodConsistency,
} from './validators/encounter-validators.js';

export class RuleRegistry {
  private businessRules: BusinessRuleMap = new Map();

  constructor() {
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
        validator: validatePatientAge
      }
    ]);

    // Observation business rules
    this.businessRules.set('Observation', [
      {
        name: 'observation-value-range-validation',
        description: 'Validate observation values are within reasonable ranges',
        validator: validateObservationValueRange
      },
      {
        name: 'observation-effective-date-validation',
        description: 'Validate observation effective date is reasonable',
        validator: validateObservationEffectiveDate
      },
      {
        name: 'observation-status-value-consistency',
        description: 'Validate observation status and value consistency',
        validator: validateObservationStatusValueConsistency
      }
    ]);

    // Condition business rules
    this.businessRules.set('Condition', [
      {
        name: 'condition-onset-date-validation',
        description: 'Validate condition onset date is reasonable',
        validator: validateConditionOnsetDate
      },
      {
        name: 'condition-status-date-consistency',
        description: 'Validate condition status and date consistency',
        validator: validateConditionStatusDateConsistency
      }
    ]);

    // Encounter business rules
    this.businessRules.set('Encounter', [
      {
        name: 'encounter-period-validation',
        description: 'Validate encounter period is reasonable',
        validator: validateEncounterPeriod
      },
      {
        name: 'encounter-status-period-consistency',
        description: 'Validate encounter status and period consistency',
        validator: validateEncounterStatusPeriodConsistency
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
