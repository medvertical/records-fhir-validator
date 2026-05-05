/**
 * Validation Messages and Issues
 * 
 * Types related to validation issues, messages, and error reporting.
 * Extracted from shared/types/validation.ts
 */

import type { ValidationSeverity } from './enums';

// ============================================================================
// Validation Issue
// ============================================================================

/**
 * A single validation issue/error/warning
 */
export interface ValidationIssue {
  id?: string;
  aspect: string;
  severity: ValidationSeverity;
  message: string;
  path?: string;
  code?: string;
  profile?: string; // Core field: profile URL this validation message belongs to
  details?: string | Record<string, any>; // Accept both string and structured objects (optional metadata only)
  suggestions?: string[];
  timestamp?: Date | string; // Accept both Date and ISO string
  humanReadable?: string; // Human-readable description for UI display
  validationMethod?: string; // Method/source of validation
  resourceType?: string; // FHIR resource type being validated
  schemaVersion?: string; // FHIR version (R4, R5, R6)
  expression?: string; // FHIRPath expression related to this issue
  ruleId?: string; // Business rule identifier
  text?: string; // Alternative text field (some validators use this instead of message)
  customMessage?: string; // Custom validation message override
  tags?: string[]; // semantic tags (e.g. ['best-practice', 'security'])
}

// ============================================================================
// Validation Error
// ============================================================================

/**
 * Validation error with context
 */
export interface ValidationError {
  code: string;
  message: string;
  resourceId?: string;
  resourceType?: string;
  path?: string;
  recoverable: boolean;
  retryAfter?: number;
  details?: Record<string, any>;
}

// ============================================================================
// Validation Retry Info
// ============================================================================

/**
 * Information about validation retry attempts
 */
export interface ValidationRetryInfo {
  maxAttempts: number;
  currentAttempt: number;
  retryDelay: number;
  lastError?: ValidationError;
  nextRetryAt?: Date;
}

/**
 * Details of a single retry attempt
 */
export interface ValidationRetryAttempt {
  attemptNumber: number;
  timestamp: Date;
  success: boolean;
  error?: ValidationError;
  duration: number;
}


