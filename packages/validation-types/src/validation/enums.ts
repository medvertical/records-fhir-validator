/**
 * Validation Enums and Type Unions
 * 
 * Centralized definitions for validation-related enums and type unions.
 * Extracted from the former shared validation type module.
 */

// ============================================================================
// Validation Aspects
// ============================================================================

/**
 * The 8 validation aspects
 */
export type ValidationAspect = 'structural' | 'profile' | 'terminology' | 'reference' | 'invariant' | 'custom_rule' | 'metadata' | 'anomaly';

/**
 * Validation severity levels
 * 
 * Maps to FHIR OperationOutcome.issue.severity codes:
 * - fatal: The issue caused the action to fail, and no further checking could be performed.
 * - error: The issue is sufficiently important to cause the action to fail.
 * - warning: The issue is not important enough to cause the action to fail, but may cause it to be performed suboptimally.
 * - information: The issue has no relation to the degree of success of the action.
 * - info: Alias for information (Records convention)
 * - inherit: Use the parent/default severity (Records configuration feature)
 */
export type ValidationSeverity = 'fatal' | 'error' | 'warning' | 'information' | 'info' | 'inherit';

/**
 * Validation strictness levels
 */
export type ValidationStrictness = 'compatibility' | 'standard' | 'strict';

// ============================================================================
// Validation Status and Actions
// ============================================================================

/**
 * Validation control state types
 */
export type ValidationStatus = 'not_running' | 'queued' | 'running' | 'paused' | 'completed' | 'error' | 'stopping';

/**
 * Validation control actions
 */
export type ValidationAction = 'start' | 'pause' | 'resume' | 'stop' | 'reset';

// ============================================================================
// Validation Engine Types
// ============================================================================

/**
 * Structural validation engine types
 */
export type StructuralValidationEngine = 'records' | 'schema' | 'hapi' | 'server';

/**
 * Profile validation engine types
 */
export type ProfileValidationEngine = 'records' | 'hapi' | 'server' | 'auto';

/**
 * Terminology validation engine types
 */
export type TerminologyValidationEngine = 'records' | 'server' | 'terminology-servers' | 'cached' | 'hapi';

/**
 * Reference validation engine types
 */
export type ReferenceValidationEngine = 'records' | 'internal' | 'server';

/**
 * Invariant validation engine types
 */
export type InvariantValidationEngine = 'fhirpath' | 'hapi';

/**
 * Custom Rule validation engine types
 */
export type CustomRuleValidationEngine = 'fhirpath' | 'custom';

/**
 * Metadata validation engine types
 */
export type MetadataValidationEngine = 'records' | 'schema' | 'hapi';

// ============================================================================
// Server Status
// ============================================================================

/**
 * Server health status
 */
export type ServerStatus =
  | 'healthy'      // Working normally
  | 'degraded'     // Slow responses
  | 'unhealthy'    // Failing requests
  | 'circuit-open' // Circuit breaker activated
  | 'unknown';     // Not yet tested

// ============================================================================
// FHIR Version
// ============================================================================

/**
 * Supported FHIR versions
 */
export type FHIRVersion = 'R4' | 'R5' | 'R6';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default validation strictness
 */
export const DEFAULT_VALIDATION_STRICTNESS: ValidationStrictness = 'standard';

/**
 * All validation aspects in order
 */
export const VALIDATION_ASPECTS: ValidationAspect[] = [
  'structural',
  'profile',
  'terminology',
  'reference',
  'invariant',
  'custom_rule',
  'metadata',
  'anomaly'
];

/**
 * Human-readable labels for validation aspects
 */
export const VALIDATION_ASPECT_LABELS: Record<ValidationAspect, string> = {
  structural: 'Structural Validation',
  profile: 'Profile Validation',
  terminology: 'Terminology Validation',
  reference: 'Reference Validation',
  invariant: 'Invariants',
  custom_rule: 'Custom Rules',
  metadata: 'Metadata Validation',
  anomaly: 'Anomaly Detection'
};

/**
 * Descriptions for validation aspects
 */
export const VALIDATION_ASPECT_DESCRIPTIONS: Record<ValidationAspect, string> = {
  structural: 'Validates basic structure, required fields, data types, and cardinality constraints',
  profile: 'Validates conformance to declared FHIR profiles and their constraints',
  terminology: 'Validates codes against code systems, value sets, and terminology bindings',
  reference: 'Verifies that references to other resources are valid and resolvable',
  invariant: 'Validates standard FHIR invariants and profile constraints (e.g. ele-1)',
  custom_rule: 'Validates user-defined business logic and custom constraints',
  metadata: 'Checks metadata requirements like lastUpdated, versionId, and tags',
  anomaly: 'Cross-resource batch analysis: duplicates, orphan references, value-range outliers, temporal gaps'
};

