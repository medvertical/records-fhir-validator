/**
 * Validator Interfaces
 * 
 * Common interfaces for all validation aspects.
 * This provides a consistent contract for all validators.
 */

import type { ValidationResult } from '@records-fhir/validation-types';

/**
 * Validation Context
 * 
 * Contains all necessary context information for validation
 */
export interface ValidationContext {
  /** FHIR Resource being validated */
  resource: any;

  /** Resource type (e.g., "Patient", "Observation") */
  resourceType: string;

  /** Optional resource ID */
  resourceId?: string;

  /** FHIR version (R4, R5, R6) */
  fhirVersion?: 'R4' | 'R5' | 'R6';

  /** Validation profiles to apply */
  profiles?: string[];

  /** Server ID for context-specific validation */
  serverId?: number;

  /** Additional metadata */
  metadata?: Record<string, any>;

  /** Validation settings */
  settings?: any;
}

/**
 * Base Validator Interface
 * 
 * All validators must implement this interface
 */
export interface IValidator {
  /**
   * Validate a resource
   * 
   * @param resource - The FHIR resource to validate
   * @param context - Validation context
   * @returns Promise<ValidationResult>
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;
}

/**
 * Structural Validator Interface
 * 
 * Validates FHIR resource structure (required fields, data types, etc.)
 */
export interface IStructuralValidator extends IValidator {
  /**
   * Validate resource structure
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;
}

/**
 * Profile Validator Interface
 * 
 * Validates FHIR resources against specified profiles
 */
export interface IProfileValidator extends IValidator {
  /**
   * Validate resource against profiles
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;

  /**
   * Get profiles for a resource
   */
  getProfilesForResource?(resourceType: string): Promise<string[]>;
}

/**
 * Terminology Validator Interface
 * 
 * Validates terminology codes (CodeableConcept, Coding, etc.)
 */
export interface ITerminologyValidator extends IValidator {
  /**
   * Validate terminology in resource
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;

  /**
   * Validate a single code
   */
  validateCode?(system: string, code: string, display?: string): Promise<boolean>;
}

/**
 * Reference Validator Interface
 * 
 * Validates FHIR references
 */
export interface IReferenceValidator extends IValidator {
  /**
   * Validate references in resource
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;

  /**
   * Check if a reference exists
   */
  checkReference?(reference: string): Promise<boolean>;
}

/**
 * Invariant Validator Interface
 * 
 * Validates invariant rules (hardcoded or standard constraints)
 */
export interface IInvariantValidator extends IValidator {
  /**
   * Validate invariant rules
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;

  /**
   * Get rules for resource type
   */
  getRulesForResourceType?(resourceType: string): Promise<any[]>;
}

/**
 * Custom Rule Validator Interface
 * 
 * Validates user-defined custom rules
 */
export interface ICustomRuleValidator extends IValidator {
  /**
   * Validate custom rules
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;
}

/**
 * Metadata Validator Interface
 * 
 * Validates resource metadata (meta field)
 */
export interface IMetadataValidator extends IValidator {
  /**
   * Validate resource metadata
   */
  validate(resource: any, context: ValidationContext): Promise<ValidationResult>;
}

/**
 * Validation Aspect
 * 
 * Represents a validation aspect with its validator
 */
export interface ValidationAspect {
  /** Aspect name */
  name: string;

  /** Validator implementation */
  validator: IValidator;

  /** Whether this aspect is enabled */
  enabled: boolean;

  /** Priority (lower = higher priority) */
  priority?: number;
}

