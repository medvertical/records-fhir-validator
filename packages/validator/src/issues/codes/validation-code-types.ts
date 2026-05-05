/**
 * Validation Message Codes - Types
 * 
 * Core type definitions for validation message catalog.
 */

import type { ValidationAspect, ValidationSeverity } from '@records-fhir/validation-types';

// ============================================================================
// Code Metadata Type
// ============================================================================

export interface ValidationCodeMetadata {
    aspect: ValidationAspect;
    severity: ValidationSeverity;
    /** Human-readable description of when this code is used */
    description?: string;
}

// Type helper for const code objects
export type CodeRegistry<T extends Record<string, ValidationCodeMetadata>> = T;
