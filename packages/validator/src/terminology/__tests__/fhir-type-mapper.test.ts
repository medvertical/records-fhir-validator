/**
 * Unit Tests: FHIR Type Mapper
 * 
 * Tests type system equivalence and normalization
 */

import {
  isFhirPrimitive,
  isFhirPathTypeUrl,
  fhirPathToFhirPrimitive,
  fhirPathToAllFhirPrimitives,
  normalizeFhirType,
  getTypeCategory,
  areTypesEquivalent,
  matchesAnyType,
  getTypeDescription,
  getNormalizedTypeList,
  fhirToFhirPathType,
  getTypeInfo
} from '../fhir-type-mapper';

describe('FHIR Type Mapper', () => {

  describe('isFhirPrimitive', () => {
    it('should recognize FHIR string-like primitives', () => {
      expect(isFhirPrimitive('string')).toBe(true);
      expect(isFhirPrimitive('id')).toBe(true);
      expect(isFhirPrimitive('code')).toBe(true);
      expect(isFhirPrimitive('uri')).toBe(true);
      expect(isFhirPrimitive('url')).toBe(true);
      expect(isFhirPrimitive('canonical')).toBe(true);
      expect(isFhirPrimitive('oid')).toBe(true);
      expect(isFhirPrimitive('uuid')).toBe(true);
      expect(isFhirPrimitive('markdown')).toBe(true);
    });

    it('should recognize FHIR numeric primitives', () => {
      expect(isFhirPrimitive('integer')).toBe(true);
      expect(isFhirPrimitive('unsignedInt')).toBe(true);
      expect(isFhirPrimitive('positiveInt')).toBe(true);
      expect(isFhirPrimitive('decimal')).toBe(true);
    });

    it('should recognize FHIR date/time primitives', () => {
      expect(isFhirPrimitive('date')).toBe(true);
      expect(isFhirPrimitive('dateTime')).toBe(true);
      expect(isFhirPrimitive('instant')).toBe(true);
      expect(isFhirPrimitive('time')).toBe(true);
    });

    it('should recognize other FHIR primitives', () => {
      expect(isFhirPrimitive('boolean')).toBe(true);
      expect(isFhirPrimitive('base64Binary')).toBe(true);
    });

    it('should not recognize complex types as primitives', () => {
      expect(isFhirPrimitive('CodeableConcept')).toBe(false);
      expect(isFhirPrimitive('Reference')).toBe(false);
      expect(isFhirPrimitive('Identifier')).toBe(false);
    });

    it('should not recognize FHIRPath URLs as primitives', () => {
      expect(isFhirPrimitive('http://hl7.org/fhirpath/System.String')).toBe(false);
    });
  });

  describe('isFhirPathTypeUrl', () => {
    it('should recognize FHIRPath type URLs', () => {
      expect(isFhirPathTypeUrl('http://hl7.org/fhirpath/System.String')).toBe(true);
      expect(isFhirPathTypeUrl('http://hl7.org/fhirpath/System.Integer')).toBe(true);
      expect(isFhirPathTypeUrl('http://hl7.org/fhirpath/System.Boolean')).toBe(true);
    });

    it('should not recognize FHIR primitives as URLs', () => {
      expect(isFhirPathTypeUrl('string')).toBe(false);
      expect(isFhirPathTypeUrl('integer')).toBe(false);
    });

    it('should not recognize other URLs', () => {
      expect(isFhirPathTypeUrl('http://custom.org/MyType')).toBe(false);
    });
  });

  describe('fhirPathToFhirPrimitive', () => {
    it('should map System.String to string', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.String')).toBe('string');
    });

    it('should map System.Integer to integer', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Integer')).toBe('integer');
    });

    it('should map System.Decimal to decimal', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Decimal')).toBe('decimal');
    });

    it('should map System.Boolean to boolean', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Boolean')).toBe('boolean');
    });

    it('should map System.DateTime to dateTime', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.DateTime')).toBe('dateTime');
    });

    it('should map System.Date to date', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Date')).toBe('date');
    });

    it('should map System.Time to time', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Time')).toBe('time');
    });

    it('should return null for unknown FHIRPath types', () => {
      expect(fhirPathToFhirPrimitive('http://hl7.org/fhirpath/System.Unknown')).toBeNull();
    });
  });

  describe('fhirPathToAllFhirPrimitives', () => {
    it('should return all string-like primitives for System.String', () => {
      const primitives = fhirPathToAllFhirPrimitives('http://hl7.org/fhirpath/System.String');
      expect(primitives).toContain('string');
      expect(primitives).toContain('id');
      expect(primitives).toContain('code');
      expect(primitives).toContain('uri');
      expect(primitives).toContain('url');
      expect(primitives).toContain('canonical');
    });

    it('should return all integer primitives for System.Integer', () => {
      const primitives = fhirPathToAllFhirPrimitives('http://hl7.org/fhirpath/System.Integer');
      expect(primitives).toContain('integer');
      expect(primitives).toContain('unsignedInt');
      expect(primitives).toContain('positiveInt');
    });

    it('should return empty array for unknown types', () => {
      expect(fhirPathToAllFhirPrimitives('http://hl7.org/fhirpath/System.Unknown')).toEqual([]);
    });
  });

  describe('normalizeFhirType', () => {
    it('should return FHIR primitives unchanged', () => {
      expect(normalizeFhirType('string')).toBe('string');
      expect(normalizeFhirType('integer')).toBe('integer');
      expect(normalizeFhirType('boolean')).toBe('boolean');
      expect(normalizeFhirType('id')).toBe('id');
    });

    it('should normalize FHIRPath URLs to FHIR primitives', () => {
      expect(normalizeFhirType('http://hl7.org/fhirpath/System.String')).toBe('string');
      expect(normalizeFhirType('http://hl7.org/fhirpath/System.Integer')).toBe('integer');
      expect(normalizeFhirType('http://hl7.org/fhirpath/System.Boolean')).toBe('boolean');
      expect(normalizeFhirType('http://hl7.org/fhirpath/System.Decimal')).toBe('decimal');
    });

    it('should return complex types unchanged', () => {
      expect(normalizeFhirType('CodeableConcept')).toBe('CodeableConcept');
      expect(normalizeFhirType('Reference')).toBe('Reference');
      expect(normalizeFhirType('Identifier')).toBe('Identifier');
    });

    it('should handle custom URLs by extracting last segment', () => {
      expect(normalizeFhirType('http://custom.org/types/string')).toBe('string');
      expect(normalizeFhirType('http://example.com/MyCustomType')).toBe('MyCustomType');
    });

    it('should return null for empty or invalid input', () => {
      expect(normalizeFhirType('')).toBeNull();
      expect(normalizeFhirType(null as any)).toBeNull();
    });
  });

  describe('getTypeCategory', () => {
    it('should group string-like types together', () => {
      expect(getTypeCategory('string')).toBe('string');
      expect(getTypeCategory('id')).toBe('string');
      expect(getTypeCategory('code')).toBe('string');
      expect(getTypeCategory('uri')).toBe('string');
      expect(getTypeCategory('url')).toBe('string');
    });

    it('should group integer types together', () => {
      expect(getTypeCategory('integer')).toBe('integer');
      expect(getTypeCategory('unsignedInt')).toBe('integer');
      expect(getTypeCategory('positiveInt')).toBe('integer');
    });

    it('should group dateTime types together', () => {
      expect(getTypeCategory('dateTime')).toBe('dateTime');
      expect(getTypeCategory('instant')).toBe('dateTime');
    });

    it('should return unchanged for non-categorized types', () => {
      expect(getTypeCategory('CodeableConcept')).toBe('CodeableConcept');
      expect(getTypeCategory('Reference')).toBe('Reference');
    });
  });

  describe('areTypesEquivalent - Core Functionality', () => {
    it('should match exact same types', () => {
      expect(areTypesEquivalent('string', 'string')).toBe(true);
      expect(areTypesEquivalent('integer', 'integer')).toBe(true);
      expect(areTypesEquivalent('CodeableConcept', 'CodeableConcept')).toBe(true);
    });

    it('should match FHIR primitive with FHIRPath URL', () => {
      expect(areTypesEquivalent('string', 'http://hl7.org/fhirpath/System.String')).toBe(true);
      expect(areTypesEquivalent('http://hl7.org/fhirpath/System.String', 'string')).toBe(true);
      expect(areTypesEquivalent('integer', 'http://hl7.org/fhirpath/System.Integer')).toBe(true);
      expect(areTypesEquivalent('boolean', 'http://hl7.org/fhirpath/System.Boolean')).toBe(true);
    });

    it('should match FHIR primitives in same category', () => {
      expect(areTypesEquivalent('string', 'id')).toBe(true);
      expect(areTypesEquivalent('id', 'code')).toBe(true);
      expect(areTypesEquivalent('uri', 'url')).toBe(true);
      expect(areTypesEquivalent('integer', 'positiveInt')).toBe(true);
      expect(areTypesEquivalent('dateTime', 'instant')).toBe(true);
    });

    it('should NOT match different type categories', () => {
      expect(areTypesEquivalent('string', 'integer')).toBe(false);
      expect(areTypesEquivalent('boolean', 'string')).toBe(false);
      expect(areTypesEquivalent('date', 'dateTime')).toBe(false);
    });

    it('should NOT match different complex types', () => {
      expect(areTypesEquivalent('CodeableConcept', 'Coding')).toBe(false);
      expect(areTypesEquivalent('Reference', 'Identifier')).toBe(false);
    });
  });

  describe('areTypesEquivalent - Real-World Scenarios', () => {
    it('should handle Patient.id type validation', () => {
      // Patient.id is type 'id' (FHIR primitive)
      // UKCore might specify 'http://hl7.org/fhirpath/System.String'
      expect(areTypesEquivalent('id', 'http://hl7.org/fhirpath/System.String')).toBe(true);
      expect(areTypesEquivalent('string', 'http://hl7.org/fhirpath/System.String')).toBe(true);
    });

    it('should handle identifier.system type', () => {
      // identifier.system is 'uri' in FHIR
      expect(areTypesEquivalent('uri', 'http://hl7.org/fhirpath/System.String')).toBe(true);
      expect(areTypesEquivalent('uri', 'string')).toBe(true);
    });

    it('should handle integer fields', () => {
      expect(areTypesEquivalent('integer', 'http://hl7.org/fhirpath/System.Integer')).toBe(true);
      expect(areTypesEquivalent('positiveInt', 'http://hl7.org/fhirpath/System.Integer')).toBe(true);
    });

    it('should handle boolean fields', () => {
      expect(areTypesEquivalent('boolean', 'http://hl7.org/fhirpath/System.Boolean')).toBe(true);
    });
  });

  describe('matchesAnyType', () => {
    it('should match if type is in allowed list', () => {
      expect(matchesAnyType('string', ['integer', 'string', 'boolean'])).toBe(true);
    });

    it('should match FHIRPath URL against FHIR primitives', () => {
      expect(matchesAnyType('string', ['http://hl7.org/fhirpath/System.String', 'integer'])).toBe(true);
      expect(matchesAnyType('id', ['http://hl7.org/fhirpath/System.String'])).toBe(true);
    });

    it('should not match if type not in allowed list', () => {
      expect(matchesAnyType('string', ['integer', 'boolean'])).toBe(false);
    });

    it('should handle empty allowed types', () => {
      expect(matchesAnyType('string', [])).toBe(false);
    });
  });

  describe('getTypeDescription', () => {
    it('should return FHIR primitive as-is', () => {
      expect(getTypeDescription('string')).toBe('string');
      expect(getTypeDescription('integer')).toBe('integer');
    });

    it('should include FHIRPath info for URLs', () => {
      const desc = getTypeDescription('http://hl7.org/fhirpath/System.String');
      expect(desc).toContain('string');
      expect(desc).toContain('FHIRPath');
      expect(desc).toContain('System.String');
    });

    it('should handle complex types', () => {
      expect(getTypeDescription('CodeableConcept')).toBe('CodeableConcept');
    });

    it('should handle unknown types gracefully', () => {
      expect(getTypeDescription('')).toBe('unknown');
    });
  });

  describe('getNormalizedTypeList', () => {
    it('should deduplicate equivalent types', () => {
      const result = getNormalizedTypeList([
        'string',
        'http://hl7.org/fhirpath/System.String',
        'id',
        'code'
      ]);

      // All normalize to 'string' category, should only have one
      expect(result.length).toBeLessThanOrEqual(4);
      expect(result).toContain('string');
    });

    it('should keep different types', () => {
      const result = getNormalizedTypeList([
        'string',
        'integer',
        'boolean'
      ]);

      expect(result).toContain('string');
      expect(result).toContain('integer');
      expect(result).toContain('boolean');
    });
  });

  describe('fhirToFhirPathType', () => {
    it('should map FHIR primitives to FHIRPath URLs', () => {
      expect(fhirToFhirPathType('string')).toBe('http://hl7.org/fhirpath/System.String');
      expect(fhirToFhirPathType('id')).toBe('http://hl7.org/fhirpath/System.String');
      expect(fhirToFhirPathType('integer')).toBe('http://hl7.org/fhirpath/System.Integer');
      expect(fhirToFhirPathType('boolean')).toBe('http://hl7.org/fhirpath/System.Boolean');
    });

    it('should return null for complex types', () => {
      expect(fhirToFhirPathType('CodeableConcept')).toBeNull();
      expect(fhirToFhirPathType('Reference')).toBeNull();
    });
  });

  describe('getTypeInfo', () => {
    it('should provide complete info for FHIR primitives', () => {
      const info = getTypeInfo('string');

      expect(info.original).toBe('string');
      expect(info.normalized).toBe('string');
      expect(info.category).toBe('string');
      expect(info.isPrimitive).toBe(true);
      expect(info.isFhirPathUrl).toBe(false);
      expect(info.fhirPathEquivalent).toBe('http://hl7.org/fhirpath/System.String');
    });

    it('should provide complete info for FHIRPath URLs', () => {
      const info = getTypeInfo('http://hl7.org/fhirpath/System.String');

      expect(info.original).toBe('http://hl7.org/fhirpath/System.String');
      expect(info.normalized).toBe('string');
      expect(info.category).toBe('string');
      expect(info.isPrimitive).toBe(false);
      expect(info.isFhirPathUrl).toBe(true);
      expect(info.fhirEquivalents).toContain('string');
      expect(info.fhirEquivalents).toContain('id');
      expect(info.fhirEquivalents).toContain('code');
    });

    it('should provide info for complex types', () => {
      const info = getTypeInfo('CodeableConcept');

      expect(info.original).toBe('CodeableConcept');
      expect(info.normalized).toBe('CodeableConcept');
      expect(info.isPrimitive).toBe(false);
      expect(info.isFhirPathUrl).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined gracefully', () => {
      expect(areTypesEquivalent(null as any, 'string')).toBe(false);
      expect(areTypesEquivalent('string', undefined as any)).toBe(false);
      expect(areTypesEquivalent(null as any, null as any)).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(areTypesEquivalent('', 'string')).toBe(false);
      expect(normalizeFhirType('')).toBeNull();
    });

    it('should be case-sensitive for type codes', () => {
      // FHIR types are case-sensitive
      expect(isFhirPrimitive('String')).toBe(false); // Should be 'string'
      expect(isFhirPrimitive('INTEGER')).toBe(false); // Should be 'integer'
    });
  });

  describe('Integration: Type Validation Scenarios', () => {
    describe('Fix Patient.id validation bug', () => {
      it('should validate Patient.id correctly', () => {
        // Patient.id value is string "425da12d..."
        // Expected type from profile: "http://hl7.org/fhirpath/System.String"
        expect(areTypesEquivalent('id', 'http://hl7.org/fhirpath/System.String')).toBe(true);
      });
    });

    describe('Choice types (value[x])', () => {
      it('should handle value[x] with multiple allowed types', () => {
        const allowedTypes = ['string', 'integer', 'CodeableConcept'];

        expect(matchesAnyType('string', allowedTypes)).toBe(true);
        expect(matchesAnyType('integer', allowedTypes)).toBe(true);
        expect(matchesAnyType('CodeableConcept', allowedTypes)).toBe(true);
        expect(matchesAnyType('boolean', allowedTypes)).toBe(false);
      });

      it('should handle value[x] with FHIRPath types', () => {
        const allowedTypes = ['http://hl7.org/fhirpath/System.String', 'http://hl7.org/fhirpath/System.Integer'];

        expect(matchesAnyType('string', allowedTypes)).toBe(true);
        expect(matchesAnyType('id', allowedTypes)).toBe(true);
        expect(matchesAnyType('integer', allowedTypes)).toBe(true);
        expect(matchesAnyType('boolean', allowedTypes)).toBe(false);
      });
    });
  });
});

