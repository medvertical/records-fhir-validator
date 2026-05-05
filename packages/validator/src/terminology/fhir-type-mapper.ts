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

// ============================================================================
// Type System Constants
// ============================================================================

/**
 * FHIRPath type system base URL
 */
const FHIRPATH_TYPE_SYSTEM = 'http://hl7.org/fhirpath/System.';

/**
 * Mapping from FHIRPath type URLs to FHIR primitive types
 * 
 * Based on FHIR specification:
 * - All string-like FHIR primitives map to System.String
 * - Integer types map to System.Integer
 * - Decimal maps to System.Decimal
 * - Boolean maps to System.Boolean
 * - DateTime types map to System.DateTime
 * - Date maps to System.Date
 * - Time maps to System.Time
 */
const FHIRPATH_TO_FHIR_MAP: Record<string, string[]> = {
  'http://hl7.org/fhirpath/System.String': [
    'string', 'id', 'code', 'uri', 'url', 'canonical', 
    'oid', 'uuid', 'markdown', 'xhtml'
  ],
  'http://hl7.org/fhirpath/System.Integer': [
    'integer', 'unsignedInt', 'positiveInt'
  ],
  'http://hl7.org/fhirpath/System.Decimal': [
    'decimal'
  ],
  'http://hl7.org/fhirpath/System.Boolean': [
    'boolean'
  ],
  'http://hl7.org/fhirpath/System.DateTime': [
    'dateTime', 'instant'
  ],
  'http://hl7.org/fhirpath/System.Date': [
    'date'
  ],
  'http://hl7.org/fhirpath/System.Time': [
    'time'
  ]
};

/**
 * All FHIR primitive type codes
 */
const FHIR_PRIMITIVES = new Set([
  // String-like primitives
  'string', 'id', 'code', 'uri', 'url', 'canonical', 'oid', 'uuid', 'markdown', 'xhtml',
  // Numeric primitives
  'integer', 'unsignedInt', 'positiveInt', 'decimal',
  // Boolean
  'boolean',
  // Date/Time primitives
  'date', 'dateTime', 'instant', 'time',
  // Binary
  'base64Binary'
]);

/**
 * Type categories for broader equivalence checking
 * Groups related FHIR primitive types together
 */
const TYPE_CATEGORIES: Record<string, string> = {
  // String-like types all belong to 'string' category
  'string': 'string',
  'id': 'string',
  'code': 'string',
  'uri': 'string',
  'url': 'string',
  'canonical': 'string',
  'oid': 'string',
  'uuid': 'string',
  'markdown': 'string',
  'xhtml': 'string',
  
  // Integer types
  'integer': 'integer',
  'unsignedInt': 'integer',
  'positiveInt': 'integer',
  
  // Decimal
  'decimal': 'decimal',
  
  // Boolean
  'boolean': 'boolean',
  
  // DateTime types
  'dateTime': 'dateTime',
  'instant': 'dateTime',
  
  // Date
  'date': 'date',
  
  // Time
  'time': 'time',
  
  // Binary
  'base64Binary': 'binary'
};

// ============================================================================
// Type Normalization Functions
// ============================================================================

/**
 * Check if a type code is a FHIR primitive
 * 
 * @param typeCode - Type code to check
 * @returns True if typeCode is a recognized FHIR primitive
 * 
 * @example
 * isFhirPrimitive('string') // true
 * isFhirPrimitive('id') // true
 * isFhirPrimitive('CodeableConcept') // false
 */
export function isFhirPrimitive(typeCode: string): boolean {
  return FHIR_PRIMITIVES.has(typeCode);
}

/**
 * Check if a type code is a FHIRPath type system URL
 * 
 * @param typeCode - Type code to check
 * @returns True if typeCode is a FHIRPath type URL
 * 
 * @example
 * isFhirPathTypeUrl('http://hl7.org/fhirpath/System.String') // true
 * isFhirPathTypeUrl('string') // false
 */
export function isFhirPathTypeUrl(typeCode: string): boolean {
  return typeCode.startsWith(FHIRPATH_TYPE_SYSTEM);
}

/**
 * Map FHIRPath type URL to FHIR primitive type
 * 
 * Returns the first (canonical) FHIR primitive for the FHIRPath type.
 * For System.String, returns 'string' (though 'id', 'code', etc. are also valid).
 * 
 * @param fhirPathUrl - FHIRPath type URL
 * @returns FHIR primitive type, or null if not recognized
 * 
 * @example
 * fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.String') // 'string'
 * fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Integer') // 'integer'
 * fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Unknown') // null
 */
export function fhirPathToFhirPrimitive(fhirPathUrl: string): string | null {
  const primitives = FHIRPATH_TO_FHIR_MAP[fhirPathUrl];
  return primitives ? primitives[0] : null;
}

/**
 * Get all FHIR primitives that map to a FHIRPath type
 * 
 * @param fhirPathUrl - FHIRPath type URL
 * @returns Array of equivalent FHIR primitive types
 * 
 * @example
 * fhirPathToAllFhirPrimitives('http://hl7.org/fhirpath/System.String')
 * // Returns: ['string', 'id', 'code', 'uri', 'url', 'canonical', 'oid', 'uuid', 'markdown', 'xhtml']
 */
export function fhirPathToAllFhirPrimitives(fhirPathUrl: string): string[] {
  return FHIRPATH_TO_FHIR_MAP[fhirPathUrl] || [];
}

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
 * Get type category for broader equivalence checking
 * 
 * Groups related types together (e.g., all string-like types → 'string')
 * 
 * @param typeCode - FHIR type code
 * @returns Type category
 * 
 * @example
 * getTypeCategory('string') // 'string'
 * getTypeCategory('id') // 'string'
 * getTypeCategory('code') // 'string'
 * getTypeCategory('integer') // 'integer'
 */
export function getTypeCategory(typeCode: string): string {
  return TYPE_CATEGORIES[typeCode] || typeCode;
}

// ============================================================================
// Type Equivalence Functions
// ============================================================================

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

// ============================================================================
// Reverse Mapping (FHIR to FHIRPath)
// ============================================================================

/**
 * Map FHIR primitive type to FHIRPath type URL
 * 
 * @param fhirType - FHIR primitive type code
 * @returns FHIRPath type URL, or null if not a primitive
 * 
 * @example
 * fhirToFhirPathType('string') // 'http://hl7.org/fhirpath/System.String'
 * fhirToFhirPathType('integer') // 'http://hl7.org/fhirpath/System.Integer'
 * fhirToFhirPathType('CodeableConcept') // null (not a primitive)
 */
export function fhirToFhirPathType(fhirType: string): string | null {
  // Find which FHIRPath type maps to this FHIR type
  for (const [fhirPathUrl, fhirPrimitives] of Object.entries(FHIRPATH_TO_FHIR_MAP)) {
    if (fhirPrimitives.includes(fhirType)) {
      return fhirPathUrl;
    }
  }
  
  return null;
}

// ============================================================================
// Debugging Utilities
// ============================================================================

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

