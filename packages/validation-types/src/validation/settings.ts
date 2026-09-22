/**
 * Validation Settings and Configuration
 * 
 * Types related to validation settings, configuration, and resource type filtering.
 * Extracted from shared/validation-settings.ts
 */

import type { FHIRVersion } from './enums.js';

export type {
  TerminologyAuthConfig,
  TerminologyServer,
  MiiTerminologyMode,
  MiiPreset,
  MiiValidationSettings,
  CircuitBreakerConfig,
  AdvancedTerminologyConfig,
} from './settings-terminology.js';

export type {
  AdvisorRule,
  AdvisorRuleApplication,
  AdvisorRuleMatch,
  AdvisorRuleTransform,
  ImposedProfilePolicy,
  ImposedProfilesConfig,
  ProfileApplicationSource,
} from './settings-policies.js';

export { PERFORMANCE_LIMITS } from './settings-performance.js';

// ============================================================================
// Validation Aspect Configuration
// ============================================================================

/**
 * Configuration for a single validation aspect
 */
export type ValidationAspectConfig = import('./settings-schema.js').ValidationAspectConfigZod;

// ============================================================================
// Profile Sources Configuration
// ============================================================================

/**
 * Configuration for remote profile sources
 * Local sources (bundled, DB cache) are always enabled
 */
export type ProfileSourcesConfig = import('./settings-schema.js').ProfileSourcesConfigZod;

// ============================================================================
// Validation Settings
// ============================================================================

/**
 * Canonical validation settings type, derived from the runtime Zod schema.
 */
export type ValidationSettings = import('./settings-schema.js').ValidationSettingsZod;

// ============================================================================
// Settings Update and Validation
// ============================================================================

/**
 * Deep-partial update type, derived from the canonical runtime schema.
 */
export type ValidationSettingsUpdate = import('./settings-schema.js').ValidationSettingsUpdateZod;

/**
 * Validation result for settings validation
 */
export interface ValidationSettingsValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Resource Type Configuration
// ============================================================================

/**
 * FHIR resource type configuration
 */
export interface FHIRResourceTypeConfig {
  version: FHIRVersion;
  includedTypes: string[];
  excludedTypes: string[];
  totalCount: number;
}
