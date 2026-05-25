/**
 * Type Validator
 * 
 * Validates FHIR data types:
 * - Primitive types (string, integer, boolean, decimal, etc.)
 * - Complex types (CodeableConcept, Reference, Identifier, etc.)
 * - FHIRPath type system URLs (System.String, System.Integer, etc.)
 * 
 * Handles type equivalence across different type systems:
 * - FHIR primitives (string, id, integer)
 * - FHIRPath types (http://hl7.org/fhirpath/System.String)
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ElementType } from '../core/structure-definition-types';
import { normalizeFhirType, getTypeDescription } from '../terminology';
import { validateUriFormat } from './uri-format-validator';
import {
  getActualFhirType,
  isExtensionOnly,
  matchesComplexType,
  matchesPrimitiveType,
  PRIMITIVE_TYPE_CODES,
} from './type-matching-helpers';

// ============================================================================
// Type Validator
// ============================================================================

export class TypeValidator {
  /**
   * Validate type of a value
   */
  async validate(
    value: any,
    types: ElementType[],
    path: string,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // If no types specified, skip validation
    if (!types || types.length === 0) {
      return issues;
    }

    // Handle array values
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemIssues = await this.validateSingle(value[i], types, `${path}[${i}]`, profileUrl);
        issues.push(...itemIssues);
      }
      return issues;
    }

    // Validate single value
    return this.validateSingle(value, types, path, profileUrl);
  }

  /**
   * Validate a single value against type definitions
   */
  private async validateSingle(
    value: any,
    types: ElementType[],
    path: string,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Try each allowed type
    let matchedType = false;

    for (const type of types) {
      const typeCode = type.code;

      // Check if value matches this type
      if (await this.matchesType(value, typeCode)) {
        matchedType = true;

        // Additional format validation for URIs
        // HAPI strictly validates that 'uri' and 'canonical' are absolute URIs (e.g. in system fields)
        const normalizedType = normalizeFhirType(typeCode);
        const effectiveType = normalizedType || typeCode;

        if (typeof value === 'string' && ['uri', 'canonical'].includes(effectiveType)) {
          // Pass resourceType as 'Unknown' here since we don't have it in context,
          // specific resource type is added by higher-level executors if needed
          const uriIssue = validateUriFormat(value, path, 'Unknown', profileUrl);
          if (uriIssue) {
            issues.push(uriIssue);
          }
        }

        break;
      }
    }

    // Non-polymorphic slot fallback: the per-type isX() heuristics exist to
    // disambiguate value[x] choice types. When the schema declares exactly
    // one complex type, a plain object should be accepted structurally —
    // field-level validators catch truly wrong shapes (unknown properties,
    // cardinality). This prevents false positives like Patient.example's
    // telecom[0] = {use: "home"} being misreported as HumanName because
    // `use` is a shared field across several FHIR datatypes.
    if (!matchedType && types.length === 1) {
      const typeCode = types[0].code;
      const effectiveType = normalizeFhirType(typeCode) || typeCode;
      const isPlainObject = typeof value === 'object' && value !== null && !Array.isArray(value);
      if (isPlainObject && !PRIMITIVE_TYPE_CODES.has(effectiveType)) {
        matchedType = true;
      }
    }

    // If no type matched, add error
    if (!matchedType) {
      // Special case: dateTime/instant without timezone
      const hasDateTimeType = types.some(t => t.code === 'dateTime' || t.code === 'instant');
      if (hasDateTimeType && typeof value === 'string' && value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) {
        issues.push(createValidationIssue({
          code: 'invalid',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          customMessage: 'If a date has a time, it must have a timezone',
          severityOverride: 'error',
        }));
      } else {
        const typeDescriptions = types.map(t => getTypeDescription(t.code));
        const expectedTypes = typeDescriptions.join(' | ');
        const actualType = getActualFhirType(value);

        issues.push(createValidationIssue({
          code: 'structural-type-mismatch',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          messageParams: { element: path, expected: expectedTypes, actual: actualType },
        }));
      }
    }

    // Whitespace-only primitive check moved to
    // StructuralExecutor.validateWhitespaceOnlyPrimitives so it runs
    // in both full-validate and lightweight validateStructure paths.

    return issues;
  }

  /**
   * Check if value matches a FHIR type
   * 
   * Handles type codes from different type systems:
   * - FHIR primitives: 'string', 'integer', 'boolean', etc.
   * - FHIRPath types: 'http://hl7.org/fhirpath/System.String', etc.
   * - Complex types: 'CodeableConcept', 'Reference', etc.
   */
  private async matchesType(value: any, typeCode: string): Promise<boolean> {
    const normalizedType = normalizeFhirType(typeCode);
    const effectiveType = normalizedType || typeCode;

    if (isExtensionOnly(value) && !PRIMITIVE_TYPE_CODES.has(effectiveType)) {
      return true;
    }

    const primitiveMatch = matchesPrimitiveType(value, effectiveType);
    if (primitiveMatch !== null) {
      return primitiveMatch;
    }

    return matchesComplexType(value, effectiveType);
  }
}
