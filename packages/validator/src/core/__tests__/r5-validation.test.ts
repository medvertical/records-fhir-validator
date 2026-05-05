/**
 * R5 Validation Tests
 *
 * Verifies that the validator correctly uses R5 FHIRPath model,
 * handles R5-specific types (CodeableReference, integer64),
 * and threads fhirVersion through the pipeline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ConstraintValidator } from '../../validators/constraint-validator';
import { TypeValidator } from '../../validators/type-validator';
import { getFhirPathModel } from '../../validators/fhirpath-model-resolver';

describe('R5 Validation', () => {

  describe('FHIRPath Model Resolver', () => {
    it('should return R4 model by default', () => {
      const model = getFhirPathModel();
      expect(model).toBeDefined();
    });

    it('should return R4 model for R4', () => {
      const model = getFhirPathModel('R4');
      expect(model).toBeDefined();
    });

    it('should return R5 model for R5', () => {
      const model = getFhirPathModel('R5');
      expect(model).toBeDefined();
    });

    it('should return R5 model for R6 (best available)', () => {
      const r5Model = getFhirPathModel('R5');
      const r6Model = getFhirPathModel('R6');
      expect(r6Model).toBe(r5Model);
    });

    it('should return different models for R4 and R5', () => {
      const r4Model = getFhirPathModel('R4');
      const r5Model = getFhirPathModel('R5');
      // The models should be different objects (different type maps)
      expect(r4Model).not.toBe(r5Model);
    });
  });

  describe('ConstraintValidator with R5', () => {
    let constraintValidator: ConstraintValidator;

    beforeAll(() => {
      constraintValidator = new ConstraintValidator();
    });

    it('should accept fhirVersion option and evaluate constraints', async () => {
      const elements = [{
        id: 'Patient',
        path: 'Patient',
        constraint: [{
          key: 'dom-6',
          severity: 'warning' as const,
          human: 'A resource should have narrative',
          expression: 'text.`div`.exists()'
        }]
      }];

      const resource = { resourceType: 'Patient', id: 'r5-test' };

      // Should work with R5 without errors
      const issues = await constraintValidator.validate(
        resource,
        elements,
        'http://hl7.org/fhir/StructureDefinition/Patient',
        { fhirVersion: 'R5' }
      );

      // dom-6 should fire (no text.div)
      const dom6 = issues.find(i => i.details?.constraintKey === 'dom-6' || i.ruleId === 'dom-6');
      expect(dom6).toBeDefined();
    }, 30000);

    it('should default to R4 when fhirVersion is not specified', async () => {
      const elements = [{
        id: 'Patient',
        path: 'Patient',
        constraint: [{
          key: 'test-r4-default',
          severity: 'error' as const,
          human: 'Always true',
          expression: 'true'
        }]
      }];

      const resource = { resourceType: 'Patient', id: 'test' };

      // Should work without fhirVersion (backward compatible)
      const issues = await constraintValidator.validate(
        resource,
        elements,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      expect(issues.length).toBe(0);
    }, 30000);
  });

  describe('TypeValidator - CodeableReference (R5)', () => {
    let typeValidator: TypeValidator;

    beforeAll(() => {
      typeValidator = new TypeValidator();
    });

    it('should validate CodeableReference with concept', async () => {
      const value = {
        concept: {
          coding: [{ system: 'http://example.org', code: '123' }],
          text: 'Test'
        }
      };

      const issues = await typeValidator.validate(
        value,
        [{ code: 'CodeableReference' }],
        'MedicationRequest.medication'
      );

      expect(issues.length).toBe(0);
    });

    it('should validate CodeableReference with reference', async () => {
      const value = {
        reference: {
          reference: 'Medication/123',
          display: 'Test medication'
        }
      };

      const issues = await typeValidator.validate(
        value,
        [{ code: 'CodeableReference' }],
        'MedicationRequest.medication'
      );

      expect(issues.length).toBe(0);
    });

    it('should validate CodeableReference with both concept and reference', async () => {
      const value = {
        concept: {
          coding: [{ system: 'http://example.org', code: '123' }]
        },
        reference: {
          reference: 'Medication/123'
        }
      };

      const issues = await typeValidator.validate(
        value,
        [{ code: 'CodeableReference' }],
        'MedicationRequest.medication'
      );

      expect(issues.length).toBe(0);
    });

    it('should reject non-object as CodeableReference', async () => {
      const issues = await typeValidator.validate(
        'not-an-object',
        [{ code: 'CodeableReference' }],
        'MedicationRequest.medication'
      );

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('structural-type-mismatch');
    });
  });

  describe('TypeValidator - integer64 (R5)', () => {
    let typeValidator: TypeValidator;

    beforeAll(() => {
      typeValidator = new TypeValidator();
    });

    it('should accept string integer64 values', async () => {
      const issues = await typeValidator.validate(
        '9007199254740993',
        [{ code: 'integer64' }],
        'Observation.valueInteger64'
      );

      expect(issues.length).toBe(0);
    });

    it('should accept numeric integer64 values', async () => {
      const issues = await typeValidator.validate(
        42,
        [{ code: 'integer64' }],
        'Observation.valueInteger64'
      );

      expect(issues.length).toBe(0);
    });

    it('should reject non-integer string as integer64', async () => {
      const issues = await typeValidator.validate(
        'not-a-number',
        [{ code: 'integer64' }],
        'Observation.valueInteger64'
      );

      expect(issues.length).toBeGreaterThan(0);
    });
  });
});
