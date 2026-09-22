/**
 * Validation Settings Utility Functions
 * 
 * Main orchestrator for validation settings utilities.
 * Delegates to specialized modules for types, defaults, validators, and transformers.
 */

import type { ValidationSettings } from './settings.js';
import type { FHIRVersion } from './enums.js';
import { PERFORMANCE_LIMITS } from './settings.js';

// Re-export types and constants
export {
  COMMON_FHIR_RESOURCE_TYPES,
  CONFORMANCE_RESOURCE_TYPES,
  R4_ALL_RESOURCE_TYPES,
  R5_ALL_RESOURCE_TYPES,
  R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
  R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
  VALIDATION_ASPECTS,
  VALIDATION_ASPECT_LABELS,
  VALIDATION_ASPECT_DESCRIPTIONS,
  type CommonFhirResourceType
} from './settings-types.js';

// Import for internal use
import { VALIDATION_ASPECTS as _VALIDATION_ASPECTS } from './settings-types.js';

// Re-export defaults
export {
  VALIDATION_CONFIGS,
  DEFAULT_TERMINOLOGY_SERVERS,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_VALIDATION_SETTINGS_R4,
  DEFAULT_VALIDATION_SETTINGS_R5,
  DEFAULT_ADVANCED_TERMINOLOGY,
  createEhds2026ValidationSettings,
  createMii2026ValidationSettings,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  type FhirPackagePin,
  type Mii2026ValidationSettingsOverrides,
  type MiiTerminologyMode
} from './settings-defaults.js';

// Import for internal use
import {
  DEFAULT_VALIDATION_SETTINGS_R4,
  DEFAULT_VALIDATION_SETTINGS_R5
} from './settings-defaults.js';

export {
  CANONICAL_CUSTOM_RULE_ASPECT,
  normalizeValidationAspect,
  normalizeValidationAspects,
  normalizeValidationSettings
} from './aspect-aliases.js';

// Re-export validators
export {
  validatePerformanceSettings,
  validateResourceTypeSettings,
  validateResourceTypeSettingsForVersion,
  validateValidationSettings
} from './settings-validators.js';

// Re-export transformers
export {
  getAllResourceTypesForVersion,
  getDefaultIncludedTypesForVersion,
  isResourceTypeAvailableInVersion,
  getUnavailableResourceTypes,
  getR5SpecificResourceTypes,
  migrateResourceTypesForVersion,
  getEffectiveResourceTypes,
  shouldValidateResourceType
} from './settings-transformers.js';

// ============================================================================
// Performance Settings Utilities
// ============================================================================

/**
 * Get default performance settings
 */
export function getDefaultPerformanceSettings(): ValidationSettings['performance'] {
  return {
    maxConcurrent: PERFORMANCE_LIMITS.maxConcurrent.default,
    batchSize: PERFORMANCE_LIMITS.batchSize.default,
    enableDeltaSearch: true
  };
}

// ============================================================================
// Validation Aspect Utilities (re-exported from settings-aspect-helpers)
// ============================================================================

export {
  getEnabledAspects,
  isAspectEnabled,
  getAspectSeverity
} from './settings-aspect-helpers.js';

// ============================================================================
// Resource Type Filtering Utilities
// ============================================================================

/**
 * Get default resource type settings
 */
export function getDefaultResourceTypeSettings(): ValidationSettings['resourceTypes'] {
  return {
    enabled: true,
    includedTypes: [],
    excludedTypes: []
  };
}

// ============================================================================
// Default Settings Utilities
// ============================================================================

/**
 * Get default validation settings for a specific FHIR version
 */
export function getDefaultValidationSettingsForVersion(version: FHIRVersion): ValidationSettings {
  const defaults = version === 'R4' ? DEFAULT_VALIDATION_SETTINGS_R4 : DEFAULT_VALIDATION_SETTINGS_R5;
  return defaults.fhirVersion === version ? defaults : { ...defaults, fhirVersion: version };
}

/**
 * Get default validation settings for R4 (backward compatibility)
 */
export function getDefaultValidationSettings(): ValidationSettings {
  return DEFAULT_VALIDATION_SETTINGS_R4;
}

/**
 * Create a copy of default settings for a specific FHIR version
 */
export function createDefaultValidationSettings(version: FHIRVersion): ValidationSettings {
  const defaults = getDefaultValidationSettingsForVersion(version);
  return JSON.parse(JSON.stringify(defaults)); // Deep copy
}

/**
 * Reset settings to defaults for a specific FHIR version
 */
export function resetToDefaultSettings(version: FHIRVersion): ValidationSettings {
  return createDefaultValidationSettings(version);
}

/**
 * Check if settings match the defaults for a specific FHIR version
 */
export function isDefaultSettings(settings: ValidationSettings, version: FHIRVersion): boolean {
  const defaults = getDefaultValidationSettingsForVersion(version);
  return JSON.stringify(settings) === JSON.stringify(defaults);
}
