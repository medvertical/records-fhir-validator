/**
 * Reference Validation Types
 * 
 * Shared types for reference validation modules.
 * Extracted from reference-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '../types';

// ============================================================================
// Reference Field Definitions
// ============================================================================

export interface ReferenceFieldDefinition {
  path: string;
  type: string;
  required?: boolean;
  targetTypes?: string[];
}

export type ReferenceFieldMap = Map<string, ReferenceFieldDefinition[]>;

// ============================================================================
// Reference Validation Results
// ============================================================================

export interface ReferenceFormatValidation {
  isValid: boolean;
  referenceType: 'relative' | 'absolute' | 'logical' | 'contained' | 'invalid';
  resourceType?: string;
  resourceId?: string;
  version?: string;
  issues: ValidationIssue[];
}

export interface ReferenceResolutionResult {
  exists: boolean;
  resourceType?: string;
  resource?: any;
  error?: string;
  resolvedFrom?: 'server' | 'bundle' | 'contained' | 'cache';
}

export interface ComprehensiveReferenceValidationResult {
  totalReferences: number;
  validReferences: number;
  invalidReferences: number;
  unresolvedReferences: number;
  issues: ValidationIssue[];
}

// ============================================================================
// Validation Options
// ============================================================================

export interface ReferenceValidationOptions {
  checkExistence?: boolean;
  checkType?: boolean;
  checkVersion?: boolean;
  checkCanonical?: boolean;
  checkCircular?: boolean;
  maxDepth?: number;
  bundle?: any;
  containedResources?: any[];
}

// ============================================================================
// Reference Info
// ============================================================================

export interface ExtractedReference {
  fieldPath: string;
  reference: string;
  referenceType: 'relative' | 'absolute' | 'logical' | 'contained';
  resourceType?: string;
  resourceId?: string;
  version?: string;
  display?: string;
  targetTypes?: string[];
  isRequired?: boolean;
}

