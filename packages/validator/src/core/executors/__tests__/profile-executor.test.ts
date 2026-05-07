/**
 * Unit Tests for Profile Executor
 * 
 * Task 18.6: Add missing tests to reach coverage gates
 * 
 * Tests profile validation:
 * - StructureDefinition conformance
 * - Extension validation
 * - Slicing validation
 * - Profile constraint validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileExecutor, type ProfileValidationContext } from '../profile-executor';
import type { StructureDefinition, ElementDefinition } from '../../structure-definition-types';
import type { ValidationIssue } from '../../../types';

// Mock dependencies
vi.mock('../../../../validators/extension-validator', () => ({
  ExtensionValidator: vi.fn().mockImplementation(() => ({
    validateExtensions: vi.fn().mockResolvedValue([])
  }))
}));

vi.mock('../../../../validators/slicing-validator', () => ({
  SlicingValidator: vi.fn().mockImplementation(() => ({
    validateSlicing: vi.fn().mockResolvedValue([])
  }))
}));

vi.mock('../../../../validators/constraint-validator', () => ({
  ConstraintValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue([])
  }))
}));

vi.mock('../../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ProfileExecutor', () => {
  let executor: ProfileExecutor;
  let mockContext: ProfileValidationContext;
  let mockStructureDef: StructureDefinition;
  let mockExtensionValidator: any;
  let mockSlicingValidator: any;
  let mockConstraintValidator: any;

  beforeEach(async () => {
    const { ExtensionValidator } = await import('../../../validators/extension-validator');
    const { SlicingValidator } = await import('../../../validators/slicing-validator');
    const { ConstraintValidator } = await import('../../../validators/constraint-validator');

    mockExtensionValidator = new ExtensionValidator();
    mockSlicingValidator = new SlicingValidator();
    mockConstraintValidator = new ConstraintValidator();

    executor = new ProfileExecutor(mockExtensionValidator, mockSlicingValidator, mockConstraintValidator);
    
    mockStructureDef = {
      id: 'test-structure',
      url: 'http://test.org/StructureDefinition/Test',
      type: 'Patient',
      snapshot: {
        element: [
          {
            path: 'Patient',
            min: 1,
            max: '1'
          } as ElementDefinition,
          {
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{
                type: 'value',
                path: 'system'
              }],
              rules: 'open'
            }
          } as ElementDefinition
        ]
      }
    };

    mockContext = {
      resource: {
        resourceType: 'Patient',
        id: 'test-001',
        identifier: [
          {
            system: 'http://example.org/ssn',
            value: '123-45-6789'
          }
        ]
      },
      resourceType: 'Patient',
      profileUrl: 'http://test.org/StructureDefinition/Test',
      fhirVersion: 'R4',
      structureDef: mockStructureDef,
      strictMode: false,
      getValueAtPath: (resource: any, path: string) => {
        const parts = path.split('.');
        let value = resource;
        for (const part of parts.slice(1)) {
          value = value?.[part];
        }
        return value;
      }
    };
  });

  describe('validate', () => {
    it('should return empty array for valid profile conformance', async () => {
      const issues = await executor.validate(mockContext);
      expect(issues).toEqual([]);
    });

    it('should validate extensions', async () => {
      const extensionIssues: ValidationIssue[] = [{
        id: 'extension-error-1',
        aspect: 'profile',
        severity: 'error',
        code: 'extension-invalid',
        message: 'Invalid extension',
        path: 'Patient.extension[0]',
        timestamp: new Date()
      }];

      mockExtensionValidator.validateExtensions = vi.fn().mockResolvedValue(extensionIssues);

      const issues = await executor.validate(mockContext);
      expect(issues).toEqual(extensionIssues);
    });

    it('should pass correct parameters to extension validator', async () => {
      const validateExtensionsSpy = vi.fn().mockResolvedValue([]);
      mockExtensionValidator.validateExtensions = validateExtensionsSpy;

      await executor.validate(mockContext);
      
      expect(validateExtensionsSpy).toHaveBeenCalledWith(
        mockContext.resource,
        mockStructureDef,
        {
          resource: mockContext.resource,
          profileSD: mockStructureDef,
          strictMode: mockContext.strictMode,
          fhirVersion: mockContext.fhirVersion,
          profileUrl: mockContext.profileUrl,
          getValueAtPath: mockContext.getValueAtPath
        }
      );
    });

    it('should validate slicing for elements with slicing definition', async () => {
      const slicingIssues: ValidationIssue[] = [{
        id: 'slicing-error-1',
        aspect: 'profile',
        severity: 'error',
        code: 'slicing-violation',
        message: 'Slicing constraint violated',
        path: 'Patient.identifier',
        timestamp: new Date()
      }];

      mockSlicingValidator.validateSlicing = vi.fn().mockResolvedValue(slicingIssues);

      const issues = await executor.validate(mockContext);
      expect(issues).toEqual(slicingIssues);
    });

    it('should normalize non-array values to array for slicing validation', async () => {
      mockContext.resource.identifier = 'not-an-array' as any;

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      // getValueAtPath flattens single-element arrays to a scalar;
      // the executor normalizes back to an array for the slicing validator
      expect(validateSlicingSpy).toHaveBeenCalledWith(
        ['not-an-array'],
        'Patient.identifier',
        expect.anything()
      );
    });

    it('should skip elements without slicing definition', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Patient.id',
          min: 0,
          max: '1'
        } as ElementDefinition
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);
      
      expect(validateSlicingSpy).not.toHaveBeenCalled();
    });

    it('should skip nested sliced elements when their parent is absent', async () => {
      mockContext.resource = {
        resourceType: 'Encounter',
        id: 'test-encounter',
      };
      mockContext.resourceType = 'Encounter';
      mockContext.structureDef.type = 'Encounter';
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.diagnosis.use.coding',
          slicing: {
            discriminator: [{ type: 'value', path: 'code' }],
            rules: 'open'
          }
        } as ElementDefinition
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      expect(validateSlicingSpy).not.toHaveBeenCalled();
    });

    it('should skip sliced declarations nested under an already matched slice', async () => {
      mockContext.resource = {
        resourceType: 'Observation',
        component: [
          {
            code: {
              coding: [{ system: 'http://loinc.org', code: '8480-6' }],
            },
          },
        ],
      };
      mockContext.resourceType = 'Observation';
      mockContext.structureDef.type = 'Observation';
      mockStructureDef.type = 'Observation';
      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.component',
          path: 'Observation.component',
          min: 1,
          max: '*',
          slicing: {
            discriminator: [{ type: 'pattern', path: 'code' }],
            rules: 'open',
          },
        } as ElementDefinition,
        {
          id: 'Observation.component:SystolicBP.code.coding',
          path: 'Observation.component.code.coding',
          min: 1,
          max: '*',
          slicing: {
            discriminator: [{ type: 'pattern', path: '$this' }],
            rules: 'open',
          },
        } as ElementDefinition,
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      expect(validateSlicingSpy).toHaveBeenCalledTimes(1);
      expect(validateSlicingSpy).toHaveBeenCalledWith(
        mockContext.resource.component,
        'Observation.component',
        expect.anything()
      );
    });

    it('should validate child slicing per parent when max is numeric and repeating', async () => {
      mockContext.resource = {
        resourceType: 'Observation',
        component: [
          { valueQuantity: { value: 120 } },
          { valueQuantity: { value: 80 } },
        ],
      };
      mockContext.resourceType = 'Observation';
      mockContext.structureDef.type = 'Observation';
      mockStructureDef.type = 'Observation';
      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.component',
          path: 'Observation.component',
          min: 1,
          max: '3',
        } as ElementDefinition,
        {
          id: 'Observation.component.value[x]',
          path: 'Observation.component.value[x]',
          min: 0,
          max: '1',
          slicing: {
            discriminator: [{ type: 'type', path: '$this' }],
            rules: 'open',
          },
        } as ElementDefinition,
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      expect(validateSlicingSpy).toHaveBeenCalledTimes(2);
      expect(validateSlicingSpy).toHaveBeenNthCalledWith(
        1,
        [{ value: 120 }],
        'Observation.component.value[x]',
        expect.anything()
      );
      expect(validateSlicingSpy).toHaveBeenNthCalledWith(
        2,
        [{ value: 80 }],
        'Observation.component.value[x]',
        expect.anything()
      );
    });

    it('should still validate missing optional top-level sliced elements', async () => {
      mockContext.resource = {
        resourceType: 'Encounter',
        id: 'test-encounter',
      };
      mockContext.resourceType = 'Encounter';
      mockContext.structureDef.type = 'Encounter';
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.type',
          min: 0,
          slicing: {
            discriminator: [{ type: 'value', path: 'coding.code' }],
            rules: 'open'
          }
        } as ElementDefinition
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      expect(validateSlicingSpy).toHaveBeenCalledWith(
        [],
        'Encounter.type',
        expect.anything()
      );
    });

    it('should not duplicate slice minimum when a required top-level element is absent', async () => {
      mockContext.resource = {
        resourceType: 'Encounter',
        id: 'test-encounter',
      };
      mockContext.resourceType = 'Encounter';
      mockContext.structureDef.type = 'Encounter';
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.type',
          min: 1,
          slicing: {
            discriminator: [{ type: 'value', path: 'coding.code' }],
            rules: 'open'
          }
        } as ElementDefinition
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);

      expect(validateSlicingSpy).not.toHaveBeenCalled();
    });

    it('should handle missing snapshot elements', async () => {
      mockContext.structureDef.snapshot = undefined;
      const validateExtensionsSpy = vi.fn().mockResolvedValue([]);
      mockExtensionValidator.validateExtensions = validateExtensionsSpy;
      
      const issues = await executor.validate(mockContext);
      
      // Should still validate extensions
      expect(validateExtensionsSpy).toHaveBeenCalled();
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should aggregate issues from extensions and slicing', async () => {
      const extensionIssues: ValidationIssue[] = [{
        id: 'extension-error',
        aspect: 'profile',
        severity: 'error',
        code: 'extension-invalid',
        message: 'Extension error',
        path: 'Patient.extension[0]',
        timestamp: new Date()
      }];

      const slicingIssues: ValidationIssue[] = [{
        id: 'slicing-error',
        aspect: 'profile',
        severity: 'warning',
        code: 'slicing-violation',
        message: 'Slicing error',
        path: 'Patient.identifier',
        timestamp: new Date()
      }];

      mockExtensionValidator.validateExtensions = vi.fn().mockResolvedValue(extensionIssues);
      mockSlicingValidator.validateSlicing = vi.fn().mockResolvedValue(slicingIssues);

      const issues = await executor.validate(mockContext);
      
      expect(issues).toHaveLength(2);
      expect(issues).toEqual([...extensionIssues, ...slicingIssues]);
    });

    it('should suppress duplicate extension slice minimum when extension cardinality already reports it', async () => {
      mockContext.resource.extension = [];
      mockStructureDef.snapshot!.element = [
        {
          path: 'Patient.extension',
          min: 0,
          max: '*',
          slicing: {
            discriminator: [{ type: 'value', path: 'url' }],
            rules: 'open'
          }
        } as ElementDefinition
      ];

      const extensionIssues: ValidationIssue[] = [{
        id: 'extension-min',
        aspect: 'profile',
        severity: 'error',
        code: 'profile-extension-min-cardinality',
        message: 'Extension requires at least 1 instance(s), found 0',
        path: 'Patient.extension',
        timestamp: new Date()
      }];

      const slicingIssues: ValidationIssue[] = [{
        id: 'slice-min',
        aspect: 'profile',
        severity: 'error',
        code: 'profile-slice-min-cardinality',
        message: 'Slice minimum cardinality not met',
        path: 'Patient.extension',
        timestamp: new Date()
      }];

      mockExtensionValidator.validateExtensions = vi.fn().mockResolvedValue(extensionIssues);
      mockSlicingValidator.validateSlicing = vi.fn().mockResolvedValue(slicingIssues);

      const issues = await executor.validate(mockContext);

      expect(issues).toEqual(extensionIssues);
    });

    it('should handle validation errors gracefully', async () => {
      mockContext.getValueAtPath = () => {
        throw new Error('Test error');
      };

      const issues = await executor.validate(mockContext);
      
      expect(issues).toHaveLength(1);
      expect(issues[0].aspect).toBe('profile');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].code).toBe('validation-error');
      expect(issues[0].message).toContain('Profile validation failed');
      expect(issues[0].message).toContain('Test error');
    });

    it('should handle non-Error exceptions', async () => {
      mockContext.getValueAtPath = () => {
        throw 'String error';
      };

      const issues = await executor.validate(mockContext);
      
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('String error');
    });

    it('should handle different strictMode settings', async () => {
      const strictModes = [true, false];
      
      for (const strictMode of strictModes) {
        mockContext.strictMode = strictMode;
        const validateExtensionsSpy = vi.fn().mockResolvedValue([]);
        mockExtensionValidator.validateExtensions = validateExtensionsSpy;
        
        await executor.validate(mockContext);
        
        expect(validateExtensionsSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ strictMode })
        );
      }
    });

    it('should handle different FHIR versions', async () => {
      const versions: Array<'R4' | 'R5' | 'R6'> = ['R4', 'R5', 'R6'];
      
      for (const version of versions) {
        mockContext.fhirVersion = version;
        const validateExtensionsSpy = vi.fn().mockResolvedValue([]);
        mockExtensionValidator.validateExtensions = validateExtensionsSpy;
        
        await executor.validate(mockContext);
        
        expect(validateExtensionsSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ fhirVersion: version })
        );
      }
    });

    it('should handle multiple sliced elements', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Patient.identifier',
          slicing: {
            discriminator: [{ type: 'value', path: 'system' }],
            rules: 'open'
          }
        } as ElementDefinition,
        {
          path: 'Patient.contact',
          slicing: {
            discriminator: [{ type: 'value', path: 'relationship' }],
            rules: 'closed'
          }
        } as ElementDefinition
      ];

      mockContext.resource.contact = [
        {
          relationship: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'C' }] }]
        }
      ];

      const validateSlicingSpy = vi.fn().mockResolvedValue([]);
      mockSlicingValidator.validateSlicing = validateSlicingSpy;

      await executor.validate(mockContext);
      
      // Should validate both sliced elements
      expect(validateSlicingSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle empty arrays for sliced elements', async () => {
      mockContext.resource.identifier = [];

      const issues = await executor.validate(mockContext);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should handle different resource types', async () => {
      const resourceTypes = ['Patient', 'Observation', 'Condition'];
      
      for (const resourceType of resourceTypes) {
        mockContext.resource = {
          resourceType,
          id: 'test-001'
        };
        mockContext.resourceType = resourceType;
        mockContext.structureDef.type = resourceType;

        const issues = await executor.validate(mockContext);
        expect(Array.isArray(issues)).toBe(true);
      }
    });
  });
});
