/**
 * Validation Settings Validators
 * 
 * Validation logic for validation settings.
 */

import type { ValidationSettings, ValidationSettingsValidationResult } from './settings';
import type { ValidationAspect, FHIRVersion } from './enums';
import { PERFORMANCE_LIMITS } from './settings';
import {
  getAllResourceTypesForVersion,
  getR5SpecificResourceTypes
} from './settings-transformers';
import {
  getEnabledAspects,
  getAspectSeverity
} from './settings-aspect-helpers';

// ============================================================================
// Performance Settings Validation
// ============================================================================

/**
 * Validate performance settings
 */
export function validatePerformanceSettings(performance: ValidationSettings['performance']): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate maxConcurrent
  if (performance.maxConcurrent < PERFORMANCE_LIMITS.maxConcurrent.min) {
    errors.push(`maxConcurrent must be at least ${PERFORMANCE_LIMITS.maxConcurrent.min}`);
  }
  if (performance.maxConcurrent > PERFORMANCE_LIMITS.maxConcurrent.max) {
    errors.push(`maxConcurrent must not exceed ${PERFORMANCE_LIMITS.maxConcurrent.max}`);
  }

  // Validate batchSize
  if (performance.batchSize < PERFORMANCE_LIMITS.batchSize.min) {
    errors.push(`batchSize must be at least ${PERFORMANCE_LIMITS.batchSize.min}`);
  }
  if (performance.batchSize > PERFORMANCE_LIMITS.batchSize.max) {
    errors.push(`batchSize must not exceed ${PERFORMANCE_LIMITS.batchSize.max}`);
  }

  // Performance warnings
  if (performance.maxConcurrent > 10) {
    warnings.push('High concurrent validation may impact server performance');
  }
  if (performance.batchSize > 75) {
    warnings.push('Large batch sizes may cause memory issues');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// Resource Type Filtering Validation
// ============================================================================

/**
 * Validate resource type filtering settings
 */
export function validateResourceTypeSettings(resourceTypes: ValidationSettings['resourceTypes']): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for conflicts between included and excluded types
  const conflicts = resourceTypes.includedTypes.filter(type =>
    resourceTypes.excludedTypes.includes(type)
  );

  if (conflicts.length > 0) {
    errors.push(`Resource types cannot be both included and excluded: ${conflicts.join(', ')}`);
  }

  // Check for empty included types when filtering is enabled
  if (resourceTypes.enabled && resourceTypes.includedTypes.length === 0) {
    warnings.push('Resource type filtering is enabled but no types are included (will validate all types)');
  }

  // Check for duplicate types
  const includedDuplicates = resourceTypes.includedTypes.filter((type, index) =>
    resourceTypes.includedTypes.indexOf(type) !== index
  );
  if (includedDuplicates.length > 0) {
    errors.push(`Duplicate included resource types: ${includedDuplicates.join(', ')}`);
  }

  const excludedDuplicates = resourceTypes.excludedTypes.filter((type, index) =>
    resourceTypes.excludedTypes.indexOf(type) !== index
  );
  if (excludedDuplicates.length > 0) {
    errors.push(`Duplicate excluded resource types: ${excludedDuplicates.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate resource type filtering settings against a specific FHIR version
 */
export function validateResourceTypeSettingsForVersion(
  resourceTypes: ValidationSettings['resourceTypes'],
  version: FHIRVersion
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const baseValidation = validateResourceTypeSettings(resourceTypes);
  const errors = [...baseValidation.errors];
  const warnings = [...baseValidation.warnings];

  const allTypesForVersion = getAllResourceTypesForVersion(version);

  // Check for invalid included types (not available in this FHIR version)
  const invalidIncludedTypes = resourceTypes.includedTypes.filter(type =>
    !allTypesForVersion.includes(type)
  );
  if (invalidIncludedTypes.length > 0) {
    errors.push(`Included resource types not available in FHIR ${version}: ${invalidIncludedTypes.join(', ')}`);
  }

  // Check for invalid excluded types (not available in this FHIR version)
  const invalidExcludedTypes = resourceTypes.excludedTypes.filter(type =>
    !allTypesForVersion.includes(type)
  );
  if (invalidExcludedTypes.length > 0) {
    errors.push(`Excluded resource types not available in FHIR ${version}: ${invalidExcludedTypes.join(', ')}`);
  }

  // Check for R5-specific types when using R4
  if (version === 'R4') {
    const r5SpecificIncluded = resourceTypes.includedTypes.filter(type =>
      getR5SpecificResourceTypes().includes(type as any)
    );
    if (r5SpecificIncluded.length > 0) {
      errors.push(`R5-specific resource types cannot be used with FHIR R4: ${r5SpecificIncluded.join(', ')}`);
    }

    const r5SpecificExcluded = resourceTypes.excludedTypes.filter(type =>
      getR5SpecificResourceTypes().includes(type)
    );
    if (r5SpecificExcluded.length > 0) {
      warnings.push(`R5-specific resource types in excluded list (will be ignored for R4): ${r5SpecificExcluded.join(', ')}`);
    }
  }

  // Performance warnings for large resource type lists
  if (resourceTypes.includedTypes.length > 50) {
    warnings.push(`Large number of included resource types (${resourceTypes.includedTypes.length}) may impact validation performance`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// Complete Settings Validation
// ============================================================================

/**
 * Validate complete validation settings against a specific FHIR version
 */
export function validateValidationSettings(
  settings: ValidationSettings,
  version: FHIRVersion
): ValidationSettingsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate performance settings
  const performanceValidation = validatePerformanceSettings(settings.performance);
  errors.push(...performanceValidation.errors);
  warnings.push(...performanceValidation.warnings);

  // Validate resource type settings for the specific FHIR version
  const resourceTypeValidation = validateResourceTypeSettingsForVersion(settings.resourceTypes, version);
  errors.push(...resourceTypeValidation.errors);
  warnings.push(...resourceTypeValidation.warnings);

  // Validate aspects
  const enabledAspects = getEnabledAspects(settings);
  if (enabledAspects.length === 0) {
    errors.push('At least one validation aspect must be enabled');
  }

  // Check for reasonable aspect configurations
  const errorSeverityAspects = enabledAspects.filter((aspect: ValidationAspect) =>
    getAspectSeverity(settings, aspect) === 'error'
  );
  if (errorSeverityAspects.length === 0) {
    warnings.push('No validation aspects are configured with error severity');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

