/**
 * Unit Tests: Type Validator
 * 
 * Tests FHIR type validation including FHIRPath type system equivalence
 */

import { TypeValidator } from '../type-validator';
import type { ElementType } from '../../core/structure-definition-types';

describe('TypeValidator', () => {
  let validator: TypeValidator;

  beforeEach(() => {
    validator = new TypeValidator();
  });

  describe('Primitive Type Validation', () => {
    it('should validate string values', async () => {
      const types: ElementType[] = [{ code: 'string' }];
      const issues = await validator.validate('hello', types, 'Patient.id');
      expect(issues).toHaveLength(0);
    });

    it('should validate integer values', async () => {
      const types: ElementType[] = [{ code: 'integer' }];
      const issues = await validator.validate(42, types, 'Patient.age');
      expect(issues).toHaveLength(0);
    });

    it('should validate boolean values', async () => {
      const types: ElementType[] = [{ code: 'boolean' }];
      const issues = await validator.validate(true, types, 'Patient.active');
      expect(issues).toHaveLength(0);
    });

    it('should reject mismatched primitive types', async () => {
      const types: ElementType[] = [{ code: 'integer' }];
      const issues = await validator.validate('not-a-number', types, 'Patient.age');
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });
  });

  describe('FHIRPath Type System Support', () => {
    it('should validate string with System.String', async () => {
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.String' }];
      const issues = await validator.validate('test-value', types, 'Patient.id');
      expect(issues).toHaveLength(0);
    });

    it('should validate integer with System.Integer', async () => {
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.Integer' }];
      const issues = await validator.validate(123, types, 'Patient.multipleBirthInteger');
      expect(issues).toHaveLength(0);
    });

    it('should validate boolean with System.Boolean', async () => {
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.Boolean' }];
      const issues = await validator.validate(false, types, 'Patient.active');
      expect(issues).toHaveLength(0);
    });

    it('should validate decimal with System.Decimal', async () => {
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.Decimal' }];
      const issues = await validator.validate(98.6, types, 'Observation.valueDecimal');
      expect(issues).toHaveLength(0);
    });

    it('should validate dateTime with System.DateTime', async () => {
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.DateTime' }];
      const issues = await validator.validate('2025-11-03T19:00:00Z', types, 'Patient.birthDate');
      expect(issues).toHaveLength(0);
    });
  });

  describe('Real-World Bug Fix: Patient.id', () => {
    it('should NOT error when Patient.id is string and type is System.String', async () => {
      // This is the exact scenario from the bug report
      const patientId = '425da12d-6344-408b-b6c9-48123ed10eec';
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.String' }];
      
      const issues = await validator.validate(patientId, types, 'Patient.id', 'https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient');
      
      expect(issues).toHaveLength(0);
    });

    it('should NOT error when identifier.system is uri and type is System.String', async () => {
      const systemUrl = 'https://fhir.nhs.uk/Id/nhs-number';
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.String' }];
      
      const issues = await validator.validate(systemUrl, types, 'Patient.identifier.system');
      
      expect(issues).toHaveLength(0);
    });

    it('should still catch actual type mismatches', async () => {
      // String value where integer is expected - should still error
      const types: ElementType[] = [{ code: 'http://hl7.org/fhirpath/System.Integer' }];
      const issues = await validator.validate('not-a-number', types, 'Patient.age');
      
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });
  });

  describe('FHIR Primitive Category Equivalence', () => {
    it('should accept id value for string type', async () => {
      // id is string-like, should match string type
      const types: ElementType[] = [{ code: 'string' }];
      const issues = await validator.validate('patient-id-123', types, 'Patient.id');
      expect(issues).toHaveLength(0);
    });

    it('should accept code value for string type', async () => {
      const types: ElementType[] = [{ code: 'string' }];
      const issues = await validator.validate('male', types, 'Patient.gender');
      expect(issues).toHaveLength(0);
    });

    it('should accept positiveInt for integer type', async () => {
      const types: ElementType[] = [{ code: 'integer' }];
      const issues = await validator.validate(5, types, 'Patient.multipleBirthInteger');
      expect(issues).toHaveLength(0);
    });
  });

  describe('Complex Type Validation', () => {
    it('should validate CodeableConcept', async () => {
      const types: ElementType[] = [{ code: 'CodeableConcept' }];
      const codeableConcept = {
        coding: [{ system: 'http://example.com', code: 'test' }]
      };
      const issues = await validator.validate(codeableConcept, types, 'Patient.maritalStatus');
      expect(issues).toHaveLength(0);
    });

    it('should validate Reference', async () => {
      const types: ElementType[] = [{ code: 'Reference' }];
      const reference = { reference: 'Patient/123' };
      const issues = await validator.validate(reference, types, 'Observation.subject');
      expect(issues).toHaveLength(0);
    });

    it('should validate Identifier', async () => {
      const types: ElementType[] = [{ code: 'Identifier' }];
      const identifier = { system: 'http://example.com', value: '123' };
      const issues = await validator.validate(identifier, types, 'Patient.identifier');
      expect(issues).toHaveLength(0);
    });
  });

  describe('Array Validation', () => {
    it('should validate arrays of values', async () => {
      const types: ElementType[] = [{ code: 'string' }];
      const values = ['John', 'Jane', 'Bob'];
      const issues = await validator.validate(values, types, 'Patient.name.given');
      expect(issues).toHaveLength(0);
    });

    it('should detect type mismatch in array elements', async () => {
      const types: ElementType[] = [{ code: 'integer' }];
      const values = [1, 2, 'three', 4];
      const issues = await validator.validate(values, types, 'Patient.multipleBirth');
      
      // Should error on the string element
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.code === 'structural-type-mismatch')).toBe(true);
    });
  });

  describe('Multiple Allowed Types (Choice Types)', () => {
    it('should accept any matching type from choices', async () => {
      const types: ElementType[] = [
        { code: 'string' },
        { code: 'integer' },
        { code: 'boolean' }
      ];
      
      const stringIssues = await validator.validate('test', types, 'Element.value');
      expect(stringIssues).toHaveLength(0);
      
      const integerIssues = await validator.validate(42, types, 'Element.value');
      expect(integerIssues).toHaveLength(0);
      
      const booleanIssues = await validator.validate(true, types, 'Element.value');
      expect(booleanIssues).toHaveLength(0);
    });

    it('should reject if none of the types match', async () => {
      const types: ElementType[] = [
        { code: 'integer' },
        { code: 'boolean' }
      ];
      
      const issues = await validator.validate('string-value', types, 'Element.value');
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });

    it('accepts extension-only complex values in choice slots', async () => {
      const types: ElementType[] = [{ code: 'dateTime' }, { code: 'Period' }];
      const value = {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        }],
      };

      const issues = await validator.validate(value, types, 'MedicationStatement.effective[x]');

      expect(issues).toHaveLength(0);
    });
  });

  describe('Mixed Type Systems', () => {
    it('should handle mix of FHIR and FHIRPath types', async () => {
      const types: ElementType[] = [
        { code: 'string' },
        { code: 'http://hl7.org/fhirpath/System.Integer' }
      ];

      const stringIssues = await validator.validate('test', types, 'Element.value');
      expect(stringIssues).toHaveLength(0);

      const integerIssues = await validator.validate(123, types, 'Element.value');
      expect(integerIssues).toHaveLength(0);
    });
  });

  describe('Non-polymorphic slot fallback', () => {
    // Regression: FHIR R4 Patient/example has telecom[0] = {use: "home"}.
    // isContactPoint's heuristic rejected this sparse object; getActualType
    // then claimed "HumanName" because isHumanName treated `use` as a
    // HumanName-plausible field. The declared-single-type slot should just
    // trust the schema for plain objects.
    it('accepts a sparse ContactPoint {use: "home"} in a single-type slot', async () => {
      const types: ElementType[] = [{ code: 'ContactPoint' }];
      const issues = await validator.validate({ use: 'home' }, types, 'Patient.telecom[0]');
      expect(issues).toHaveLength(0);
    });

    it('still rejects a string in a declared ContactPoint slot', async () => {
      const types: ElementType[] = [{ code: 'ContactPoint' }];
      const issues = await validator.validate('not-an-object', types, 'Patient.telecom[0]');
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });

    it('still rejects a primitive type mismatch in a single-type slot', async () => {
      const types: ElementType[] = [{ code: 'integer' }];
      const issues = await validator.validate({ not: 'an-integer' }, types, 'Patient.multipleBirthInteger');
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });
  });
});
