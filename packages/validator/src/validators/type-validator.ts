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
import { normalizeFhirType, areTypesEquivalent as _areTypesEquivalent, getTypeDescription } from '../terminology';
import { validateUriFormat } from './uri-format-validator';

// ============================================================================
// Type Validator
// ============================================================================

export class TypeValidator {
  /**
   * FHIR primitive type codes, matched against the effective (post-normalization)
   * type. Used by the non-polymorphic fallback in validateSingle — for primitive
   * slots we still require the right JS type, only complex slots trust the schema.
   */
  private static readonly PRIMITIVE_TYPE_CODES = new Set<string>([
    'string', 'code', 'markdown', 'id', 'uri', 'url', 'canonical', 'oid', 'uuid', 'xhtml',
    'integer', 'unsignedInt', 'positiveInt', 'integer64',
    'decimal', 'boolean',
    'date', 'dateTime', 'instant', 'time',
    'base64Binary',
  ]);

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
      if (isPlainObject && !TypeValidator.PRIMITIVE_TYPE_CODES.has(effectiveType)) {
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
        const actualType = this.getActualType(value);

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
    // Normalize type code (handles FHIRPath URLs → FHIR primitives)
    const normalizedType = normalizeFhirType(typeCode);
    const effectiveType = normalizedType || typeCode;

    if (
      this.isExtensionOnly(value) &&
      !TypeValidator.PRIMITIVE_TYPE_CODES.has(effectiveType)
    ) {
      return true;
    }

    // Handle primitive types (using normalized type)
    switch (effectiveType) {
      case 'string':
      case 'code':
      case 'markdown':
      case 'id':
      case 'uri':
      case 'url':
      case 'canonical':
      case 'oid':
      case 'uuid':
      case 'xhtml':
        return typeof value === 'string';

      case 'integer':
      case 'unsignedInt':
      case 'positiveInt':
        return Number.isInteger(value);

      // R5/R6: integer64 - 64-bit signed integer (may be string in JSON for precision)
      case 'integer64':
        // integer64 can be a number (if safe integer) or string representation
        if (typeof value === 'string') {
          return /^-?\d+$/.test(value) && !isNaN(parseInt(value, 10));
        }
        return Number.isInteger(value);

      case 'decimal':
        return typeof value === 'number';

      case 'boolean':
        return typeof value === 'boolean';

      case 'date':
        return typeof value === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);

      case 'dateTime':
      case 'instant':
        if (typeof value === 'string' && value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) {
          return false; // timezone check — specific message emitted by caller
        }
        return typeof value === 'string' && this.isValidDateTime(value);

      case 'time':
        return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/.test(value);

      case 'base64Binary':
        return typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value);

      // Complex types — any FHIR element can validly consist of only
      // extension(s) and/or id. An extension-only object matches any
      // complex type because all sub-elements are optional in R4.
      case 'CodeableConcept':
        return this.isCodeableConcept(value);

      case 'Coding':
        return this.isCoding(value);

      case 'Reference':
        return this.isReference(value);

      case 'Identifier':
        return this.isIdentifier(value);

      case 'HumanName':
        return this.isHumanName(value);

      case 'Address':
        return this.isAddress(value);

      case 'ContactPoint':
        return this.isContactPoint(value);

      case 'Period':
        return this.isPeriod(value);

      case 'Quantity':
      case 'SimpleQuantity':
        return this.isQuantity(value);

      case 'Range':
        return this.isRange(value);

      case 'Ratio':
        return this.isRatio(value);

      case 'Attachment':
        return this.isAttachment(value);

      case 'Annotation':
        return this.isAnnotation(value);

      // R5+: CodeableReference combines CodeableConcept + Reference
      case 'CodeableReference':
        return this.isCodeableReference(value);

      // Backbone elements and Resources
      case 'BackboneElement':
      case 'Element':
        return typeof value === 'object' && value !== null;

      case 'Resource':
        return typeof value === 'object' && value !== null && typeof value.resourceType === 'string';

      default:
        // For unknown types, assume object
        return typeof value === 'object' && value !== null;
    }
  }

  /**
   * Get actual type of value for error messages
   */
  private getActualType(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';

    const jsType = typeof value;
    if (jsType === 'object' && value.resourceType) {
      return value.resourceType;
    }

    // Check for FHIR complex types
    // IMPORTANT: Order matters! Check more specific types before less specific ones.
    // Coding ({system, code}) and CodeableConcept ({coding}) must be checked before
    // ContactPoint ({system, value}) since they share the 'system' property.
    if (this.isHumanName(value)) return 'HumanName';
    if (this.isAddress(value)) return 'Address';
    if (this.isCodeableConcept(value)) return 'CodeableConcept';
    if (this.isCoding(value)) return 'Coding';
    if (this.isContactPoint(value)) return 'ContactPoint'; // Must be after Coding!
    if (this.isIdentifier(value)) return 'Identifier';
    if (this.isCodeableReference(value)) return 'CodeableReference';
    if (this.isReference(value)) return 'Reference';
    if (this.isPeriod(value)) return 'Period';
    if (this.isQuantity(value)) return 'Quantity';
    if (this.isRange(value)) return 'Range';
    if (this.isRatio(value)) return 'Ratio';
    if (this.isAttachment(value)) return 'Attachment';
    if (this.isAnnotation(value)) return 'Annotation';

    return jsType;
  }

  // ==========================================================================
  // Type Checkers for Complex Types
  // ==========================================================================

  private isValidDateTime(value: string): boolean {
    // Strict FHIR R4 dateTime regex:
    //   year[-MM[-DD[Thh:mm:ss[.f…][timezone]]]]
    // Enforces:
    //   - Month 01-12
    //   - Day  01-31 (calendar-day validity is then cross-checked below)
    //   - Hour 00-23, Minute/Second 00-59 (leap second 60 allowed)
    //   - Timezone Z | ±00:00..14:00
    // Source: R4 dateTime StructureDefinition regex, trimmed to the
    // fields Records actually emits.
    const fhirDateTimeRe = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/;
    if (!fhirDateTimeRe.test(value)) return false;

    // Pattern match is necessary but not sufficient: 2026-02-31 matches
    // the regex but is not a real calendar day. Cross-check with the
    // native Date parser for anything that reaches day granularity.
    const dayMatch = value.match(/^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/);
    if (dayMatch) {
      const [, y, m, d] = dayMatch;
      const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
      if (dt.getUTCFullYear() !== Number(y)
        || (dt.getUTCMonth() + 1) !== Number(m)
        || dt.getUTCDate() !== Number(d)) {
        return false;
      }
    }
    return true;
  }

  private isCodeableConcept(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.coding !== undefined || value.text !== undefined);
  }

  private isCoding(value: any): boolean {
    // Coding MUST have 'code' - system alone is ambiguous (could be ContactPoint/Identifier)
    // Also exclude ContactPoint-specific properties
    return typeof value === 'object' &&
      value !== null &&
      value.code !== undefined &&  // 'code' is essential for Coding
      value.rank === undefined &&  // rank is ContactPoint-only
      !Array.isArray(value.coding); // Not a CodeableConcept
  }

  private isReference(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.reference !== undefined || value.identifier !== undefined || value.display !== undefined);
  }

  private isIdentifier(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.system !== undefined || value.value !== undefined);
  }

  private isHumanName(value: any): boolean {
    // HumanName: any object that has HumanName-specific properties OR
    // doesn't have properties exclusive to other complex types.
    // In non-polymorphic contexts (Patient.name is always HumanName)
    // we must not reject a minimal HumanName like {text: "Name"} just
    // because it ALSO matches Address heuristics. The safe approach:
    // accept anything that isn't clearly something else.
    if (typeof value !== 'object' || value === null) return false;
    // Positive match: has any HumanName-specific field
    if (value.family !== undefined || value.given !== undefined ||
        value.prefix !== undefined || value.suffix !== undefined) {
      return true;
    }
    // Negative exclusion: if it has Address/ContactPoint-only fields, reject
    if (value.line !== undefined || value.city !== undefined ||
        value.state !== undefined || value.postalCode !== undefined ||
        value.country !== undefined || value.district !== undefined) {
      return false; // Looks like Address
    }
    if (value.system !== undefined && value.value !== undefined) {
      return false; // Looks like ContactPoint or Coding
    }
    if (value.rank !== undefined) {
      return false; // ContactPoint-only
    }
    // Fallback: accept only if it has at least one HumanName-plausible
    // field (text, use, period). An object with ONLY extension/id keys
    // is ambiguous (any FHIR element can have just extensions) — don't
    // claim it as HumanName.
    if (value.text !== undefined || value.use !== undefined || value.period !== undefined) {
      return true;
    }
    return false;
  }

  private isAddress(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.use !== undefined || value.type !== undefined || value.text !== undefined ||
        value.line !== undefined || value.city !== undefined || value.district !== undefined ||
        value.state !== undefined || value.postalCode !== undefined || value.country !== undefined ||
        value.period !== undefined);
  }

  private isContactPoint(value: any): boolean {
    // ContactPoint: requires value when system is present, or has rank (unique to ContactPoint)
    // Exclude Coding-like patterns (has 'code')
    return typeof value === 'object' &&
      value !== null &&
      value.code === undefined &&  // Exclude Coding patterns
      (value.rank !== undefined ||  // rank is unique to ContactPoint
        (value.system !== undefined && value.value !== undefined) ||  // system+value pattern
        (value.value !== undefined && (value.use !== undefined || value.period !== undefined)));  // value+use/period
  }

  private isPeriod(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.start !== undefined || value.end !== undefined);
  }

  private isQuantity(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (typeof value.value === 'number' || value.unit !== undefined ||
        value.system !== undefined || value.code !== undefined);
  }

  private isRange(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.low !== undefined || value.high !== undefined);
  }

  private isRatio(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.numerator !== undefined || value.denominator !== undefined);
  }

  private isAttachment(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.contentType !== undefined || value.language !== undefined || value.data !== undefined ||
        value.url !== undefined || value.size !== undefined || value.hash !== undefined ||
        value.title !== undefined || value.creation !== undefined);
  }

  private isAnnotation(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.text !== undefined || value.authorReference !== undefined || value.authorString !== undefined || value.time !== undefined);
  }

  /**
   * R5+: CodeableReference combines a CodeableConcept and a Reference.
   * Structure: { concept?: CodeableConcept, reference?: Reference }
   * Distinguishing from plain Reference: CodeableReference.reference is an object (Reference),
   * while Reference.reference is a string (literal reference).
   */
  private isCodeableReference(value: any): boolean {
    return typeof value === 'object' &&
      value !== null &&
      (value.concept !== undefined || (value.reference !== undefined && typeof value.reference === 'object'));
  }

  /**
   * Any FHIR element can validly consist of only extension(s) and/or id.
   * An extension-only object matches any complex type because all
   * sub-elements are optional in R4.
   */
  private isExtensionOnly(value: any): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every(k => k === 'extension' || k === 'id');
  }
}
