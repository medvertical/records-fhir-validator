/**
 * FHIR Type Mapper Utility
 * 
 * Handles type system equivalence between:
 * - FHIR primitive types (string, integer, boolean, etc.)
 * - FHIRPath type system URLs (http://hl7.org/fhirpath/System.String, etc.)
 * - Custom type URLs
 * 
 * Key Responsibilities:
 * - Normalize type codes from different type systems
 * - Check type equivalence across systems
 * - Map FHIRPath type URLs to FHIR primitives
 * 
 * Example Usage:
 * ```typescript
 * // Check if types are equivalent
 * areTypesEquivalent('string', 'http://hl7.org/fhirpath/System.String') // true
 * areTypesEquivalent('id', 'http://hl7.org/fhirpath/System.String') // true
 * areTypesEquivalent('integer', 'http://hl7.org/fhirpath/System.Integer') // true
 * ```
 */

import {
  fhirPathToAllFhirPrimitives,
  fhirPathToFhirPrimitive,
  fhirToFhirPathType,
  getTypeCategory,
  isFhirPathTypeUrl,
  isFhirPrimitive,
} from './fhir-type-mapping-core.js';

export {
  fhirPathToAllFhirPrimitives,
  fhirPathToFhirPrimitive,
  fhirToFhirPathType,
  getTypeCategory,
  isFhirPathTypeUrl,
  isFhirPrimitive,
} from './fhir-type-mapping-core.js';

// ============================================================================
// Type Normalization Functions
// ============================================================================

/**
 * Normalize a type code to a canonical FHIR primitive
 * 
 * Handles:
 * - FHIR primitives (returned as-is)
 * - FHIRPath type URLs (mapped to FHIR primitive)
 * - Custom URLs (attempts to extract type from URL)
 * 
 * @param typeCode - Type code from StructureDefinition
 * @returns Normalized FHIR type, or null if cannot be normalized
 * 
 * @example
 * normalizeFhirType('string') // 'string'
 * normalizeFhirType('http://hl7.org/fhirpath/System.String') // 'string'
 * normalizeFhirType('http://hl7.org/fhirpath/System.Integer') // 'integer'
 * normalizeFhirType('CodeableConcept') // 'CodeableConcept' (complex type, unchanged)
 */
export function normalizeFhirType(typeCode: string): string | null {
  if (!typeCode) {
    return null;
  }
  
  // 1. If already a FHIR primitive, return as-is
  if (isFhirPrimitive(typeCode)) {
    return typeCode;
  }
  
  // 2. If FHIRPath URL, map to FHIR primitive
  if (isFhirPathTypeUrl(typeCode)) {
    return fhirPathToFhirPrimitive(typeCode);
  }
  
  // 3. If it's a URL but not FHIRPath, try to extract type from last segment
  if (typeCode.includes('://')) {
    const segments = typeCode.split('/');
    const lastName = segments[segments.length - 1];
    
    // Check if last segment is a FHIR primitive
    if (isFhirPrimitive(lastName)) {
      return lastName;
    }
    
    // Check if last segment is a complex type
    // Return it for complex type checking
    return lastName;
  }
  
  // 4. Not a URL - could be complex type or unknown
  // Return as-is for complex type validation
  return typeCode;
}

/**
 * Check if two type codes are equivalent
 * 
 * Handles equivalence across type systems:
 * - FHIR primitive vs FHIRPath type URL
 * - FHIR primitive vs FHIR primitive (same category)
 * - Complex types (exact match)
 * 
 * @param type1 - First type code
 * @param type2 - Second type code
 * @returns True if types are equivalent
 * 
 * @example
 * // FHIR vs FHIRPath equivalence
 * areTypesEquivalent('string', 'http://hl7.org/fhirpath/System.String') // true
 * areTypesEquivalent('id', 'http://hl7.org/fhirpath/System.String') // true
 * areTypesEquivalent('integer', 'http://hl7.org/fhirpath/System.Integer') // true
 * 
 * // FHIR primitive category equivalence
 * areTypesEquivalent('string', 'id') // true (both string-like)
 * areTypesEquivalent('integer', 'positiveInt') // true (both integer-like)
 * 
 * // Different types
 * areTypesEquivalent('string', 'integer') // false
 * areTypesEquivalent('string', 'http://hl7.org/fhirpath/System.Integer') // false
 * 
 * // Complex types (exact match required)
 * areTypesEquivalent('CodeableConcept', 'CodeableConcept') // true
 * areTypesEquivalent('CodeableConcept', 'Coding') // false
 */
export function areTypesEquivalent(type1: string, type2: string): boolean {
  if (!type1 || !type2) {
    return false;
  }
  
  // Exact match (fast path)
  if (type1 === type2) {
    return true;
  }
  
  // Normalize both types
  const norm1 = normalizeFhirType(type1);
  const norm2 = normalizeFhirType(type2);
  
  // If normalization failed for either, fall back to exact match
  if (!norm1 || !norm2) {
    return type1 === type2;
  }
  
  // Check if normalized types match
  if (norm1 === norm2) {
    return true;
  }
  
  // Check if both belong to same type category
  // This handles cases like 'id' vs 'string', both are string-like
  const category1 = getTypeCategory(norm1);
  const category2 = getTypeCategory(norm2);
  
  return category1 === category2;
}

/**
 * Check if a value matches any of the allowed types
 * 
 * Useful when an element can have multiple types (choice types like value[x]).
 * Normalizes all types before checking.
 * 
 * @param actualType - The actual type of the value
 * @param allowedTypes - Array of allowed type codes
 * @returns True if actualType matches any allowed type
 * 
 * @example
 * matchesAnyType('string', ['http://hl7.org/fhirpath/System.String', 'integer']) // true
 * matchesAnyType('id', ['string', 'Reference']) // true
 * matchesAnyType('integer', ['string', 'boolean']) // false
 */
export function matchesAnyType(actualType: string, allowedTypes: string[]): boolean {
  if (!actualType || !allowedTypes || allowedTypes.length === 0) {
    return false;
  }
  
  // Check equivalence against each allowed type
  for (const allowedType of allowedTypes) {
    if (areTypesEquivalent(actualType, allowedType)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get human-readable type description
 * 
 * Converts type codes to user-friendly descriptions for error messages.
 * 
 * @param typeCode - Type code (FHIR or FHIRPath)
 * @returns Human-readable type description
 * 
 * @example
 * getTypeDescription('string') // 'string'
 * getTypeDescription('http://hl7.org/fhirpath/System.String') // 'string (FHIRPath System.String)'
 * getTypeDescription('CodeableConcept') // 'CodeableConcept'
 */
export function getTypeDescription(typeCode: string): string {
  if (!typeCode) {
    return 'unknown';
  }
  
  // If it's a FHIRPath URL, include both URL type and FHIR equivalent
  if (isFhirPathTypeUrl(typeCode)) {
    const fhirEquivalent = fhirPathToFhirPrimitive(typeCode);
    const typeName = typeCode.split('.').pop(); // Extract 'String' from 'System.String'
    
    if (fhirEquivalent) {
      return `${fhirEquivalent} (FHIRPath System.${typeName})`;
    }
    
    return `FHIRPath System.${typeName}`;
  }
  
  // For regular FHIR types, return as-is
  return typeCode;
}

/**
 * Get normalized type list for error messages
 * 
 * Normalizes a list of type codes and removes duplicates.
 * Useful for displaying expected types in validation errors.
 * 
 * @param typeCodes - Array of type codes
 * @returns Normalized, deduplicated type list
 * 
 * @example
 * getNormalizedTypeList(['string', 'http://hl7.org/fhirpath/System.String', 'id'])
 * // Returns: ['string'] (all normalize to same category)
 */
export function getNormalizedTypeList(typeCodes: string[]): string[] {
  const normalized = new Set<string>();
  
  for (const typeCode of typeCodes) {
    const norm = normalizeFhirType(typeCode);
    if (norm) {
      normalized.add(norm);
    } else {
      // If can't normalize, keep original
      normalized.add(typeCode);
    }
  }
  
  return Array.from(normalized);
}

/**
 * Get detailed type information for debugging
 * 
 * @param typeCode - Type code to analyze
 * @returns Detailed type information
 */
export function getTypeInfo(typeCode: string): {
  original: string;
  normalized: string | null;
  category: string;
  isPrimitive: boolean;
  isFhirPathUrl: boolean;
  fhirEquivalents?: string[];
  fhirPathEquivalent?: string | null;
} {
  const normalized = normalizeFhirType(typeCode);
  const category = normalized ? getTypeCategory(normalized) : typeCode;
  
  return {
    original: typeCode,
    normalized,
    category,
    isPrimitive: isFhirPrimitive(typeCode),
    isFhirPathUrl: isFhirPathTypeUrl(typeCode),
    fhirEquivalents: isFhirPathTypeUrl(typeCode) 
      ? fhirPathToAllFhirPrimitives(typeCode) 
      : undefined,
    fhirPathEquivalent: isFhirPrimitive(typeCode) 
      ? fhirToFhirPathType(typeCode) 
      : undefined
  };
}
