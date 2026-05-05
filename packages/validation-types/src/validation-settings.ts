/**
 * @deprecated Back-compat facade for the 0.1.x line. Will be removed in
 *   `@records-fhir/validation-types@0.2.0`. Migrate imports to the root:
 *
 *   ```ts
 *   // Before
 *   import type { ValidationSettings } from '@records-fhir/validation-types/validation-settings';
 *
 *   // After
 *   import type { ValidationSettings } from '@records-fhir/validation-types';
 *   ```
 *
 *   Symbols missing from the root barrel (TerminologyAuthConfig,
 *   AdvancedTerminologyConfig, COMMON_FHIR_RESOURCE_TYPES, etc.) will be
 *   added to the root before the facade is removed; see the 0.2.0
 *   migration guide for the canonical paths.
 *
 * This file used to be the single source of truth for validation
 * settings types. It now re-exports the split modules in `./validation/`
 * so the same symbols stay reachable through both paths during the
 * deprecation window.
 */

// ============================================================================
// Re-export Types from Split Modules
// ============================================================================

// Re-export all types from the centralized validation module
export type {
  ValidationAspect,
  ValidationSeverity,
  ValidationStrictness,
  ServerStatus,
  FHIRVersion,
  StructuralValidationEngine,
  ProfileValidationEngine,
  TerminologyValidationEngine,
  ReferenceValidationEngine,
  InvariantValidationEngine,
  CustomRuleValidationEngine,
  MetadataValidationEngine
} from './validation/enums';

export type {
  ValidationAspectConfig,
  ProfileSourcesConfig,
  TerminologyServer,
  TerminologyAuthConfig,
  CircuitBreakerConfig,
  ValidationSettings,
  ValidationSettingsUpdate,
  ValidationSettingsValidationResult,
  FHIRResourceTypeConfig,
  AdvancedTerminologyConfig,
  AdvisorRule,
  AdvisorRuleMatch,
  AdvisorRuleTransform
} from './validation/settings';

export { PERFORMANCE_LIMITS } from './validation/settings';

// ============================================================================
// Re-export Constants and Utilities from Split Modules
// ============================================================================

export {
  // Resource type constants
  COMMON_FHIR_RESOURCE_TYPES,
  CONFORMANCE_RESOURCE_TYPES,
  R4_ALL_RESOURCE_TYPES,
  R5_ALL_RESOURCE_TYPES,
  R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
  R5_DEFAULT_INCLUDED_RESOURCE_TYPES,

  // Validation configs
  VALIDATION_CONFIGS,

  // Default terminology servers
  DEFAULT_TERMINOLOGY_SERVERS,

  // Circuit breaker config
  DEFAULT_CIRCUIT_BREAKER_CONFIG,

  // Cache config
  DEFAULT_CACHE_CONFIG,

  // Default settings
  DEFAULT_VALIDATION_SETTINGS_R4,
  DEFAULT_VALIDATION_SETTINGS_R5,
  createMii2026ValidationSettings,
  MII_2026_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  type FhirPackagePin,
  type Mii2026ValidationSettingsOverrides,
  type MiiTerminologyMode,

  // Advanced terminology defaults
  DEFAULT_ADVANCED_TERMINOLOGY,

  // Performance utilities
  validatePerformanceSettings,
  getDefaultPerformanceSettings,

  // FHIR version utilities
  getAllResourceTypesForVersion,
  getDefaultIncludedTypesForVersion,
  isResourceTypeAvailableInVersion,
  getUnavailableResourceTypes,
  getR5SpecificResourceTypes,
  migrateResourceTypesForVersion,

  // Resource type filtering utilities
  validateResourceTypeSettings,
  validateResourceTypeSettingsForVersion,
  getEffectiveResourceTypes,
  shouldValidateResourceType,
  getDefaultResourceTypeSettings,

  // Validation aspect utilities
  VALIDATION_ASPECTS,
  VALIDATION_ASPECT_LABELS,
  VALIDATION_ASPECT_DESCRIPTIONS,
  getEnabledAspects,
  isAspectEnabled,
  getAspectSeverity,

  // Complete settings validation
  validateValidationSettings,
  getDefaultValidationSettingsForVersion,
  getDefaultValidationSettings,
  createDefaultValidationSettings,
  resetToDefaultSettings,
  isDefaultSettings
} from './validation/settings-utils';

// ============================================================================
// Type Exports for Backward Compatibility
// ============================================================================

export type CommonFhirResourceType = typeof import('./validation/settings-utils').COMMON_FHIR_RESOURCE_TYPES[number];
