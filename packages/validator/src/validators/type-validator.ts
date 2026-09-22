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

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { normalizeResourceType } from '../issues/resource-type-normalizer.js';
import type { ElementType } from '../core/structure-definition-types.js';
import { normalizeFhirType, getTypeDescription } from '../terminology/index.js';
import { validateUriFormat } from './uri-format-validator.js';
import {
  getActualFhirType,
  isExtensionOnly,
  matchesComplexType,
  matchesPrimitiveType,
  PRIMITIVE_TYPE_CODES,
} from './type-matching-helpers.js';
import { getResolvedPrimitiveSidecarType, isResolvedPrimitiveSidecarValue } from '../core/fhir-primitive-sidecar.js';
import {
  buildDateTimeFormatDetails,
  validateDateYearPlausibility,
  validatePrimitiveStringFormat,
} from './primitive-string-format-validator.js';
import { validateDecimalRange } from './decimal-range-validator.js';

// ============================================================================
// Type Validator
// ============================================================================

export class TypeValidator {
  /**
   * Validate type of a value
   */
  async validate(
    value: unknown,
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
    value: unknown,
    types: ElementType[],
    path: string,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const effectiveTypes = narrowTypesForConcreteChoicePath(types, path);
    const resourceType = inferResourceTypeFromPath(path);

    // Try each allowed type
    let matchedType = false;

    for (const type of effectiveTypes) {
      const typeCode = type.code;

      // Check if value matches this type
      if (await this.matchesType(value, typeCode)) {
        matchedType = true;

        // Additional format validation for URIs
        // HAPI strictly validates that 'uri' and 'canonical' are absolute URIs (e.g. in system fields)
        const normalizedType = normalizeFhirType(typeCode);
        const effectiveType = normalizedType || typeCode;

        if (typeof value === 'string' && ['uri', 'canonical'].includes(effectiveType)) {
          const uriIssue = validateUriFormat(value, path, resourceType, profileUrl);
          if (uriIssue) {
            issues.push(uriIssue);
          }
        }

        if (typeof value === 'string') {
          const formatIssue = validatePrimitiveStringFormat(value, effectiveType, path, profileUrl);
          if (formatIssue) {
            issues.push(formatIssue);
          } else {
            const plausibilityIssue = validateDateYearPlausibility(value, effectiveType, path, profileUrl);
            if (plausibilityIssue) {
              issues.push(plausibilityIssue);
            }
          }
        }

        if (typeof value === 'number' && effectiveType === 'decimal') {
          const rangeIssue = validateDecimalRange(value, path, profileUrl);
          if (rangeIssue) {
            issues.push(rangeIssue);
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
    if (!matchedType && effectiveTypes.length === 1) {
      const typeCode = effectiveTypes[0].code;
      const effectiveType = normalizeFhirType(typeCode) || typeCode;
      const isPlainObject = typeof value === 'object' && value !== null && !Array.isArray(value);
      if (isPlainObject && !PRIMITIVE_TYPE_CODES.has(effectiveType)) {
        matchedType = true;
      }
    }

    // If no type matched, add error
    if (!matchedType) {
      // Special case: dateTime/instant without timezone
      const hasDateTimeType = effectiveTypes.some(t => t.code === 'dateTime' || t.code === 'instant');
      if (hasDateTimeType && typeof value === 'string' && value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) {
        issues.push(createValidationIssue({
          code: 'structural-invalid-format',
          path,
          resourceType,
          profile: profileUrl,
          customMessage: 'If a date has a time, it must have a timezone',
          severityOverride: 'error',
          details: buildDateTimeFormatDetails(value, 'dateTime'),
        }));
      } else {
        const typeDescriptions = effectiveTypes.map(t => getTypeDescription(t.code));
        const expectedTypes = typeDescriptions.join(' | ');
        const actualType = getActualFhirType(value);
        const primitiveOnly = effectiveTypes.every(type => {
          const normalized = normalizeFhirType(type.code) || type.code;
          return PRIMITIVE_TYPE_CODES.has(normalized);
        });

        issues.push(createValidationIssue({
          code: primitiveOnly
            ? 'structural-primitive-type-mismatch'
            : 'structural-type-mismatch',
          path,
          resourceType,
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
  private async matchesType(value: unknown, typeCode: string): Promise<boolean> {
    const normalizedType = normalizeFhirType(typeCode);
    const effectiveType = normalizedType || typeCode;

    if (isResolvedPrimitiveSidecarValue(value) && PRIMITIVE_TYPE_CODES.has(effectiveType)) {
      const primitiveSidecarType = getResolvedPrimitiveSidecarType(value);
      return primitiveSidecarType ? primitiveSidecarType === effectiveType : true;
    }

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

function inferResourceTypeFromPath(path: string): string {
  return normalizeResourceType('Unknown', path);
}

function narrowTypesForConcreteChoicePath(types: ElementType[], path: string): ElementType[] {
  if (!types || types.length <= 1) return types;
  const lastSegment = path.split('.').pop()?.replace(/\[\d+\]$/, '');
  if (!lastSegment || lastSegment.endsWith('[x]')) return types;

  const matched = types
    .map(type => ({ type, suffix: choiceSuffixForType(type.code) }))
    .filter(({ suffix }) =>
      Boolean(suffix) && lastSegment.length > suffix!.length && lastSegment.endsWith(suffix!)
    )
    .sort((left, right) => right.suffix!.length - left.suffix!.length)[0]?.type;

  return matched ? [matched] : types;
}

function choiceSuffixForType(typeCode: string): string | null {
  const effectiveType = normalizeFhirType(typeCode) || typeCode;
  if (!effectiveType) return null;
  if (effectiveType === 'SimpleQuantity') return 'Quantity';
  return effectiveType.charAt(0).toUpperCase() + effectiveType.slice(1);
}
