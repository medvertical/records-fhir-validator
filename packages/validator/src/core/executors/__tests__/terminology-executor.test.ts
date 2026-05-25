/**
 * Unit Tests for Terminology Executor
 * 
 * Task 18.6: Add missing tests to reach coverage gates
 * 
 * Tests terminology validation:
 * - ValueSet binding validation
 * - CodeSystem validation
 * - Terminology expansion
 * - Binding strength enforcement
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StructureDefinition, ElementDefinition } from '../../structure-definition-types';
import type { ValidationIssue } from '../../../types';

// Hoist mock constructor so it is available before module imports are evaluated
const { MockValueSetValidator, getMockInstance } = vi.hoisted(() => {
  let lastInstance: any = null;
  class MockValueSetValidator {
    validateBinding = vi.fn().mockResolvedValue([]);
    isExternalCodeSystem = vi.fn().mockReturnValue(false);
    validateCodeInCodeSystem = vi.fn().mockResolvedValue({ valid: true });
    setResolutionConfig = vi.fn();
    getResolutionConfig = vi.fn().mockReturnValue({ strategy: 'local' });
    clearCache = vi.fn();
    constructor() { lastInstance = this; }
  }
  return { MockValueSetValidator, getMockInstance: () => lastInstance };
});

// Mock path resolves relative to this test file and matches the import path
// used in terminology-executor.ts.
vi.mock('../../../validators/valueset-validator', () => ({
  ValueSetValidator: MockValueSetValidator
}));

// Now import after mocks are set up
import { TerminologyExecutor, type TerminologyValidationContext } from '../terminology-executor';
import { buildInvalidUcumIssueDetails, buildInvalidUcumMessage } from '../terminology-ucum-rules';

vi.mock('../../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('TerminologyExecutor', () => {
  let executor: TerminologyExecutor;
  let mockContext: TerminologyValidationContext;
  let mockStructureDef: StructureDefinition;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new TerminologyExecutor();
    // Reset the mock instance's validateBinding after construction
    const instance = getMockInstance();
    if (instance) instance.validateBinding.mockResolvedValue([]);
    
    mockStructureDef = {
      id: 'test-structure',
      url: 'http://test.org/StructureDefinition/Test',
      type: 'Observation',
      snapshot: {
        element: [
          {
            path: 'Observation',
            min: 1,
            max: '1'
          } as ElementDefinition,
          {
            path: 'Observation.status',
            min: 1,
            max: '1',
            type: [{ code: 'code' }],
            binding: {
              strength: 'required',
              valueSet: 'http://hl7.org/fhir/ValueSet/observation-status'
            }
          } as ElementDefinition,
          {
            path: 'Observation.code',
            min: 1,
            max: '1',
            type: [{ code: 'CodeableConcept' }],
            binding: {
              strength: 'required',
              valueSet: 'http://loinc.org'
            }
          } as ElementDefinition
        ]
      }
    };

    mockContext = {
      resource: {
        resourceType: 'Observation',
        id: 'test-001',
        status: 'final',
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '33747-0',
            display: 'Temperature'
          }]
        }
      },
      structureDef: mockStructureDef,
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
    it('should return empty array for valid terminology bindings', async () => {
      // Spy on the validator instance's validateBinding method
      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);
      
      const issues = await executor.validate(mockContext);
      
      expect(issues).toEqual([]);
      validateBindingSpy.mockRestore();
    });

    it('does not report non-required binding warnings for codes fixed by the same profile element', async () => {
      mockStructureDef.url = 'http://example.org/StructureDefinition/fixed-vital-code';
      mockStructureDef.snapshot!.element = [
        { path: 'Observation', min: 1, max: '1' } as ElementDefinition,
        {
          id: 'Observation.code',
          path: 'Observation.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'extensible',
            valueSet: 'http://hl7.org/fhir/ValueSet/observation-vitalsignresult',
          },
          patternCodeableConcept: {
            coding: [{
              system: 'http://loinc.org',
              code: '8289-1',
            }],
          },
        } as ElementDefinition,
      ];
      mockContext.resource.code = {
        coding: [{
          system: 'http://loinc.org',
          code: '8289-1',
          display: 'Head Occipital-frontal circumference Percentile',
        }],
      };
      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([{
        id: 'binding-warning',
        aspect: 'terminology',
        severity: 'warning',
        code: 'terminology-binding-extensible',
        message: 'Code is not in extensible ValueSet',
        path: 'Observation.code',
        timestamp: new Date(),
      }]);

      const issues = await executor.validate(mockContext);

      expect(issues.some(issue => issue.code === 'terminology-binding-extensible')).toBe(false);
      expect(validateBindingSpy).not.toHaveBeenCalledWith(
        mockContext.resource.code,
        expect.objectContaining({ strength: 'extensible' }),
        'Observation.code',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('should skip elements without bindings', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.id',
          min: 0,
          max: '1'
        } as ElementDefinition
      ];

      const issues = await executor.validate(mockContext);
      expect(issues).toEqual([]);
    });

    it('should validate elements with bindings', async () => {
      // Create a context with only one binding to test single validation
      const singleBindingContext = {
        ...mockContext,
        structureDef: {
          ...mockStructureDef,
          snapshot: {
            element: [
              {
                path: 'Observation.status',
                min: 1,
                max: '1',
                type: [{ code: 'code' }],
                binding: {
                  strength: 'required',
                  valueSet: 'http://hl7.org/fhir/ValueSet/observation-status'
                }
              } as ElementDefinition
            ]
          }
        },
        resource: {
          resourceType: 'Observation',
          id: 'test-001',
          status: 'final'
        }
      };

      const mockIssues: ValidationIssue[] = [{
        id: 'terminology-error-1',
        aspect: 'terminology',
        severity: 'error',
        code: 'binding-violation',
        message: 'Code not in value set',
        path: 'Observation.status',
        timestamp: new Date()
      }];

      const executorWithMock = new TerminologyExecutor();
      const validatorInstance = (executorWithMock as any).valuesetValidator;
      validatorInstance.validateBinding = vi.fn().mockResolvedValue(mockIssues);

      const issues = await executorWithMock.validate(singleBindingContext);
      expect(issues).toEqual(mockIssues);
    });

    it('does not report required binding errors for unrelated value set slice roots', async () => {
      const conditionProfile: StructureDefinition = {
        id: 'condition-profile',
        url: 'http://example.org/StructureDefinition/condition-profile',
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:us-core',
              path: 'Condition.category',
              sliceName: 'us-core',
              min: 1,
              max: '*',
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:screening-assessment',
              path: 'Condition.category',
              sliceName: 'screening-assessment',
              min: 0,
              max: '*',
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:sdoh',
              path: 'Condition.category',
              sliceName: 'sdoh',
              min: 0,
              max: '*',
              patternCodeableConcept: {
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                  code: 'sdoh',
                }],
              },
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
          }],
        }],
      };
      const context: TerminologyValidationContext = {
        resource,
        structureDef: conditionProfile,
        getValueAtPath: (input: any, path: string) => {
          if (path === 'Condition.category') return input.category;
          return undefined;
        },
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.validateBinding.mockImplementation(async (_value: unknown, binding: any) => {
        if (binding.valueSet === 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern') {
          return [];
        }
        return [{
          id: 'screening-binding',
          aspect: 'terminology',
          severity: 'error',
          code: 'terminology-binding-required',
          message: 'Code not in screening-assessment value set',
          path: 'Condition.category',
          timestamp: new Date(),
        } satisfies ValidationIssue];
      });

      const issues = await executor.validate(context);

      expect(issues).toEqual([]);
      expect(validatorInstance.validateBinding).toHaveBeenCalledTimes(2);
    });

    it('keeps required binding errors for required value set slice roots', async () => {
      const conditionProfile: StructureDefinition = {
        id: 'condition-profile',
        url: 'http://example.org/StructureDefinition/condition-profile',
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:us-core',
              path: 'Condition.category',
              sliceName: 'us-core',
              min: 1,
              max: '*',
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:screening-assessment',
              path: 'Condition.category',
              sliceName: 'screening-assessment',
              min: 0,
              max: '*',
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
              },
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      };
      const context: TerminologyValidationContext = {
        resource,
        structureDef: conditionProfile,
        getValueAtPath: (input: any, path: string) => {
          if (path === 'Condition.category') return input.category;
          return undefined;
        },
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.validateBinding.mockImplementation(async (_value: unknown, binding: any) => [{
        id: binding.valueSet,
        aspect: 'terminology',
        severity: 'error',
        code: 'terminology-binding-required',
        message: `Code not in ${binding.valueSet}`,
        path: 'Condition.category',
        timestamp: new Date(),
      } satisfies ValidationIssue]);

      const issues = await executor.validate(context);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        code: 'terminology-binding-required',
        message: expect.stringContaining('us-core-problem-or-health-concern'),
      }));
    });

    it('should skip null/undefined values', async () => {
      // Create context with only status field set to null
      const nullStatusContext = {
        ...mockContext,
        structureDef: {
          ...mockStructureDef,
          snapshot: {
            element: [
              {
                path: 'Observation.status',
                min: 1,
                max: '1',
                type: [{ code: 'code' }],
                binding: {
                  strength: 'required',
                  valueSet: 'http://hl7.org/fhir/ValueSet/observation-status'
                }
              } as ElementDefinition
            ]
          }
        },
        resource: {
          resourceType: 'Observation',
          id: 'test-001',
          status: null // null value should be skipped
        }
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.fn().mockResolvedValue([]); // Return empty array if called
      const originalMethod = validatorInstance.validateBinding;
      validatorInstance.validateBinding = validateBindingSpy;

      await executor.validate(nullStatusContext);
      
      // Should not call validateBinding for null values
      expect(validateBindingSpy).not.toHaveBeenCalled();
      validatorInstance.validateBinding = originalMethod;
    });

    it('should handle missing snapshot elements', async () => {
      mockContext.structureDef.snapshot = undefined;
      const issues = await executor.validate(mockContext);
      expect(issues).toEqual([]);
    });

    it('should handle empty snapshot elements', async () => {
      mockContext.structureDef.snapshot = { element: [] };
      const issues = await executor.validate(mockContext);
      expect(issues).toEqual([]);
    });

    it('should aggregate issues from multiple bindings', async () => {
      const statusIssues: ValidationIssue[] = [{
        id: 'status-error',
        aspect: 'terminology',
        severity: 'error',
        code: 'binding-violation',
        message: 'Status code invalid',
        path: 'Observation.status',
        timestamp: new Date()
      }];

      const codeIssues: ValidationIssue[] = [{
        id: 'code-error',
        aspect: 'terminology',
        severity: 'error',
        code: 'binding-violation',
        message: 'Code invalid',
        path: 'Observation.code',
        timestamp: new Date()
      }];

      const executorWithMock = new TerminologyExecutor();
      const validatorInstance = (executorWithMock as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockImplementation(async (value, binding, path) => {
        if (path === 'Observation.status') {
          return statusIssues;
        } else if (path === 'Observation.code') {
          return codeIssues;
        }
        return [];
      });

      const issues = await executorWithMock.validate(mockContext);
      
      expect(issues.length).toBeGreaterThanOrEqual(2);
      expect(issues).toEqual([...statusIssues, ...codeIssues]);
      validateBindingSpy.mockRestore();
    });

    it('keeps global CodeSystem display hygiene as a warning on the display path', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '394712000',
            display: 'Urine microscopy (procedure)',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.code') return resource.code;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        message: "Wrong Display Name 'Urine microscopy (procedure)' for http://snomed.info/sct#394712000",
        issues: [{
          severity: 'error',
          code: 'invalid-display',
          message: "Wrong Display Name 'Urine microscopy (procedure)' for http://snomed.info/sct#394712000",
          expression: ['display'],
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(validatorInstance.validateCodeInCodeSystem).toHaveBeenCalledWith(
        '394712000',
        'http://snomed.info/sct',
        'Urine microscopy (procedure)',
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-display-mismatch',
        path: 'Observation.code.coding[0].display',
      }));
    });

    it('validates CodeSystem displays inside CodeableConcept arrays', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.type',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Encounter',
        type: [{
          coding: [{
            system: 'http://snomed.info/sct',
            code: '183452005',
            display: 'Encounter Inpatient',
          }],
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Encounter.type') return resource.type;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        display: 'Emergency hospital admission',
        message:
          "Wrong Display Name 'Encounter Inpatient' for http://snomed.info/sct#183452005. " +
          "Valid display is 'Emergency hospital admission'",
        issues: [{
          severity: 'error',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Encounter Inpatient' for http://snomed.info/sct#183452005. " +
            "Valid display is 'Emergency hospital admission'",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(validatorInstance.validateCodeInCodeSystem).toHaveBeenCalledWith(
        '183452005',
        'http://snomed.info/sct',
        'Encounter Inpatient',
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-display-mismatch',
        path: 'Encounter.type[0].coding[0].display',
      }));
    });

    it('validates bindings for each CodeableConcept repetition', async () => {
      const binding = {
        strength: 'extensible',
        valueSet: 'http://hl7.org/fhir/ValueSet/identifier-type',
      };
      mockStructureDef.snapshot!.element = [
        {
          path: 'Patient.identifier.type',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
          binding,
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Patient',
        identifier: [
          {
            type: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                code: 'SS',
                display: 'Social Security Number',
              }],
            },
          },
          {
            type: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                code: 'DL',
                display: "Driver's License",
              }],
            },
          },
        ],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Patient.identifier.type') {
          return resource.identifier.map((identifier: any) => identifier.type);
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;

      await executor.validate(mockContext);

      expect(validatorInstance.validateBinding).toHaveBeenCalledTimes(2);
      expect(validatorInstance.validateBinding).toHaveBeenNthCalledWith(
        1,
        mockContext.resource.identifier[0].type,
        binding,
        'Patient.identifier.type',
        { profileUrl: mockStructureDef.url, fhirVersion: 'R4' },
      );
      expect(validatorInstance.validateBinding).toHaveBeenNthCalledWith(
        2,
        mockContext.resource.identifier[1].type,
        binding,
        'Patient.identifier.type',
        { profileUrl: mockStructureDef.url, fhirVersion: 'R4' },
      );
    });

    it('suppresses CodeSystem display mismatches that differ only by case or spacing', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'MedicationRequest.medication[x]',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'MedicationRequest',
        medicationCodeableConcept: {
          coding: [{
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: '198405',
            display: 'Ibuprofen 100 MG Oral Tablet',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'MedicationRequest.medication[x]') return resource.medicationCodeableConcept;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        display: 'ibuprofen 100 MG Oral Tablet',
        message:
          "Wrong Display Name 'Ibuprofen 100 MG Oral Tablet' for http://www.nlm.nih.gov/research/umls/rxnorm#198405. " +
          "Valid display is 'ibuprofen 100 MG Oral Tablet'",
        issues: [{
          severity: 'warning',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Ibuprofen 100 MG Oral Tablet' for http://www.nlm.nih.gov/research/umls/rxnorm#198405. " +
            "Valid display is 'ibuprofen 100 MG Oral Tablet'",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(0);
    });

    it('suppresses CodeSystem display mismatches when the server lists the display as an accepted choice', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '9279-1',
            display: 'Respiratory Rate',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.code') return resource.code;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        message:
          "Wrong Display Name 'Respiratory Rate' for http://loinc.org#9279-1. " +
          "Valid display is one of 3 choices: 'Respiraciones:Sistema respiratorio :Punto temporal:NRat:Cuantitativo:' (es-MX) " +
          "or 'Respiratory rate' (en) or 'Atemfrequenz' (de-DE) (for the language(s) '--')",
        issues: [{
          severity: 'warning',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Respiratory Rate' for http://loinc.org#9279-1. " +
            "Valid display is one of 3 choices: 'Respiraciones:Sistema respiratorio :Punto temporal:NRat:Cuantitativo:' (es-MX) " +
            "or 'Respiratory rate' (en) or 'Atemfrequenz' (de-DE) (for the language(s) '--')",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(0);
    });

    it('suppresses SNOMED FSN semantic-tag display variants', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Procedure.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Procedure',
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '430193006',
            display: 'Medication Reconciliation (procedure)',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Procedure.code') return resource.code;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        message:
          "Wrong Display Name 'Medication Reconciliation (procedure)' for http://snomed.info/sct#430193006. " +
          "Valid display is one of 4 choices: 'Medication reconciliation' (en-x-sctlang-90000000-00005090-07)",
        issues: [{
          severity: 'warning',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Medication Reconciliation (procedure)' for http://snomed.info/sct#430193006. " +
            "Valid display is one of 4 choices: 'Medication reconciliation' (en-x-sctlang-90000000-00005090-07)",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(0);
    });

    it('suppresses SNOMED display punctuation and truncated semantic-tag variants', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Procedure.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Procedure',
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '311555007',
            display: 'Speech and language therapy regime (regime/therapy',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Procedure.code') return resource.code;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        display: 'Speech and language therapy regime',
        message:
          "Wrong Display Name 'Speech and language therapy regime (regime/therapy' for http://snomed.info/sct#311555007. " +
          "Valid display is 'Speech and language therapy regime'",
        issues: [{
          severity: 'warning',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Speech and language therapy regime (regime/therapy' for http://snomed.info/sct#311555007. " +
            "Valid display is 'Speech and language therapy regime'",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(0);
    });

    it('suppresses CodeSystem display mismatches that differ only by punctuation', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.type',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Encounter',
        type: [{
          coding: [{
            system: 'http://snomed.info/sct',
            code: '185349003',
            display: "Encounter for 'check-up'",
          }],
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Encounter.type') return resource.type;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        display: 'Encounter for check up',
        message:
          "Wrong Display Name 'Encounter for ''check-up''' for http://snomed.info/sct#185349003. " +
          "Valid display is 'Encounter for check up'",
        issues: [{
          severity: 'warning',
          code: 'invalid-display',
          message:
            "Wrong Display Name 'Encounter for ''check-up''' for http://snomed.info/sct#185349003. " +
            "Valid display is 'Encounter for check up'",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(0);
    });

    it('keeps coded value display mismatches as warnings', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.value[x]',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        valueCodeableConcept: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '394712000',
            display: 'Urine leukocyte test',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.value[x]') return resource.valueCodeableConcept;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: false,
        reason: 'display-mismatch',
        message: "Wrong Display Name 'Urine leukocyte test' for http://snomed.info/sct#394712000",
        issues: [{
          severity: 'error',
          code: 'invalid-display',
          message: "Wrong Display Name 'Urine leukocyte test' for http://snomed.info/sct#394712000",
          expression: ['display'],
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-display-mismatch',
        path: 'Observation.value[x].coding[0].display',
      }));
    });

    it('keeps local LOINC display fallback mismatches as warnings', async () => {
      mockStructureDef.snapshot!.element = [];
      mockContext.resource = {
        resourceType: 'Observation',
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8716-3',
            display: 'Vital signs',
          }],
        },
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-display-mismatch',
        path: 'Observation.code.coding[0].display',
      }));
    });

    it('classifies ValueSet URLs used as Coding.system with a specific terminology code', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Patient.maritalStatus',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Patient',
        maritalStatus: {
          coding: [{
            system: 'http://hl7.org/fhir/ValueSet/marital-status',
            code: 'M',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Patient.maritalStatus') return resource.maritalStatus;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toEqual([
        expect.objectContaining({
          severity: 'error',
          code: 'terminology-coding-system-valueset',
          path: 'Patient.maritalStatus.coding[0].system',
          details: expect.objectContaining({
            valueSetUrl: 'http://hl7.org/fhir/ValueSet/marital-status',
          }),
        }),
      ]);
    });

    it('keeps inactive CodeSystem warnings even when the terminology server returns result=true', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Condition.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Condition',
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '15777000',
            display: 'Prediabetes',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Condition.code') return resource.code;
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      validatorInstance.isExternalCodeSystem.mockReturnValue(true);
      validatorInstance.validateCodeInCodeSystem.mockResolvedValue({
        valid: true,
        inactive: true,
        message: "The concept '15777000' has a status of inactive and its use should be reviewed",
        issues: [{
          severity: 'warning',
          code: 'code-comment',
          message: "The concept '15777000' has a status of inactive and its use should be reviewed",
        }],
      });

      const issues = await executor.validate(mockContext);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-code-inactive',
        path: 'Condition.code.coding[0].code',
      }));
    });

    it('should handle validation errors gracefully', async () => {
      mockContext.getValueAtPath = () => {
        throw new Error('Test error');
      };

      const issues = await executor.validate(mockContext);
      
      expect(issues).toHaveLength(1);
      expect(issues[0].aspect).toBe('terminology');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].code).toBe('validation-error');
      expect(issues[0].message).toContain('Terminology validation failed');
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

    it('should handle different binding strengths', async () => {
      const strengths = ['required', 'extensible', 'preferred', 'example'];
      
      for (const strength of strengths) {
        mockStructureDef.snapshot!.element = [
          {
            path: 'Observation.status',
            min: 1,
            max: '1',
            binding: {
              strength: strength as any,
              valueSet: 'http://hl7.org/fhir/ValueSet/observation-status'
            }
          } as ElementDefinition
        ];

        const issues = await executor.validate(mockContext);
        expect(Array.isArray(issues)).toBe(true);
      }
    });

    it('passes each non-sliced array item as a binding candidate', async () => {
      const codeableConceptArray = [
        {
          coding: [{
            system: 'http://loinc.org',
            code: '33747-0'
          }]
        },
        {
          coding: [{
            system: 'http://loinc.org',
            code: '33748-0'
          }]
        }
      ];
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.component.code',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'required',
            valueSet: 'http://loinc.org',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        component: codeableConceptArray.map(code => ({ code })),
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.component.code') {
          return resource.component.map((component: any) => component.code);
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);
      
      expect(validateBindingSpy).toHaveBeenCalledTimes(2);
      expect(validateBindingSpy).toHaveBeenNthCalledWith(
        1,
        codeableConceptArray[0],
        expect.any(Object),
        'Observation.component.code',
        expect.any(Object),
      );
      expect(validateBindingSpy).toHaveBeenNthCalledWith(
        2,
        codeableConceptArray[1],
        expect.any(Object),
        'Observation.component.code',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('does not apply coded choice bindings to concrete Duration values', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Specimen.collection.fastingStatus[x]',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }, { code: 'Duration' }],
          binding: {
            strength: 'required',
            valueSet: 'http://terminology.hl7.org/ValueSet/v2-0916',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Specimen',
        collection: {
          fastingStatusDuration: {
            value: 4,
            system: 'http://unitsofmeasure.org',
            code: 'h',
          },
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Specimen.collection.fastingStatus[x]') {
          return resource.collection.fastingStatusDuration;
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).not.toHaveBeenCalled();
      validateBindingSpy.mockRestore();
    });

    it('applies sliced Coding bindings only to matching patternCoding values', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.code.coding:sct',
          path: 'Observation.code.coding',
          sliceName: 'sct',
          min: 0,
          max: '0',
          type: [{ code: 'Coding' }],
          patternCoding: {
            system: 'http://snomed.info/sct',
          },
          binding: {
            strength: 'required',
            valueSet: 'http://example.org/fhir/ValueSet/snomed-only',
          },
        } as ElementDefinition,
        {
          id: 'Observation.code.coding:loinc',
          path: 'Observation.code.coding',
          sliceName: 'loinc',
          min: 1,
          max: '1',
          type: [{ code: 'Coding' }],
          patternCoding: {
            system: 'http://loinc.org',
          },
          binding: {
            strength: 'required',
            valueSet: 'http://example.org/fhir/ValueSet/loinc-only',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '20056-8',
            },
          ],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.code.coding') {
          return resource.code.coding;
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).toHaveBeenCalledTimes(1);
      expect(validateBindingSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'http://loinc.org',
          code: '20056-8',
        }),
        expect.objectContaining({
          valueSet: 'http://example.org/fhir/ValueSet/loinc-only',
        }),
        'Observation.code.coding',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('applies sliced Coding bindings only to values matching child patterns', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.code.coding:sct',
          path: 'Observation.code.coding',
          sliceName: 'sct',
          min: 0,
          max: '*',
          type: [{ code: 'Coding' }],
          binding: {
            strength: 'required',
            valueSet: 'http://example.org/fhir/ValueSet/snomed-only',
          },
        } as ElementDefinition,
        {
          id: 'Observation.code.coding:sct.system',
          path: 'Observation.code.coding.system',
          min: 1,
          max: '1',
          patternUri: 'http://snomed.info/sct',
        } as ElementDefinition,
        {
          id: 'Observation.code.coding:loinc',
          path: 'Observation.code.coding',
          sliceName: 'loinc',
          min: 1,
          max: '*',
          type: [{ code: 'Coding' }],
          binding: {
            strength: 'required',
            valueSet: 'http://example.org/fhir/ValueSet/loinc-only',
          },
        } as ElementDefinition,
        {
          id: 'Observation.code.coding:loinc.system',
          path: 'Observation.code.coding.system',
          min: 1,
          max: '1',
          patternUri: 'http://loinc.org',
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '76531-3',
            },
          ],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.code.coding') {
          return resource.code.coding;
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).toHaveBeenCalledTimes(1);
      expect(validateBindingSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'http://loinc.org',
          code: '76531-3',
        }),
        expect.objectContaining({
          valueSet: 'http://example.org/fhir/ValueSet/loinc-only',
        }),
        'Observation.code.coding',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('does not apply required bindings from non-matching slice descendants', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Practitioner.identifier',
          path: 'Practitioner.identifier',
          min: 1,
          max: '*',
          slicing: {
            discriminator: [{ type: 'value', path: '$this' }],
            rules: 'open',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:NPI',
          path: 'Practitioner.identifier',
          sliceName: 'NPI',
          min: 0,
          max: '*',
          pattern: {
            system: 'http://hl7.org/fhir/sid/us-npi',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:NPI.use',
          path: 'Practitioner.identifier.use',
          min: 0,
          max: '1',
          type: [{ code: 'code' }],
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/ValueSet/identifier-use',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:ein',
          path: 'Practitioner.identifier',
          sliceName: 'ein',
          min: 0,
          max: '1',
          pattern: {
            system: 'urn:oid:2.16.840.1.113883.4.4',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:ein.use',
          path: 'Practitioner.identifier.use',
          min: 1,
          max: '1',
          type: [{ code: 'code' }],
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/ValueSet/identifier-use',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Practitioner',
        identifier: [{
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: '1234567890',
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Practitioner.identifier') return resource.identifier;
        if (path === 'Practitioner.identifier.use') {
          return resource.identifier.map((identifier: any) => identifier.use).filter(Boolean);
        }
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues.some(issue => issue.code === 'binding-required-missing')).toBe(false);
    });

    it('does not report a terminology error when a non-sliced required element is absent', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Patient.gender',
          path: 'Patient.gender',
          min: 1,
          max: '1',
          type: [{ code: 'code' }],
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Patient',
        id: 'missing-gender',
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Patient.gender') return resource.gender;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues.some(issue => issue.code === 'binding-required-missing')).toBe(false);
    });

    it('reports missing required bindings for matching slice descendants', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Practitioner.identifier',
          path: 'Practitioner.identifier',
          min: 1,
          max: '*',
          slicing: {
            discriminator: [{ type: 'value', path: '$this' }],
            rules: 'open',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:ein',
          path: 'Practitioner.identifier',
          sliceName: 'ein',
          min: 0,
          max: '1',
          pattern: {
            system: 'urn:oid:2.16.840.1.113883.4.4',
          },
        } as ElementDefinition,
        {
          id: 'Practitioner.identifier:ein.use',
          path: 'Practitioner.identifier.use',
          min: 1,
          max: '1',
          type: [{ code: 'code' }],
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/ValueSet/identifier-use',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Practitioner',
        identifier: [{
          system: 'urn:oid:2.16.840.1.113883.4.4',
          value: '12-3456789',
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Practitioner.identifier') return resource.identifier;
        if (path === 'Practitioner.identifier.use') {
          return resource.identifier.map((identifier: any) => identifier.use).filter(Boolean);
        }
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          aspect: 'terminology',
          severity: 'error',
          code: 'binding-required-missing',
          path: 'Practitioner.identifier.use',
        }),
      ]));
    });

    it('resolves choice-type values for matching slice descendants', async () => {
      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.component',
          path: 'Observation.component',
          min: 0,
          max: '*',
          slicing: {
            discriminator: [{ type: 'pattern', path: 'code' }],
            rules: 'open',
          },
        } as ElementDefinition,
        {
          id: 'Observation.component:representative-coding-hgvs',
          path: 'Observation.component',
          sliceName: 'representative-coding-hgvs',
          min: 0,
          max: '1',
        } as ElementDefinition,
        {
          id: 'Observation.component:representative-coding-hgvs.code',
          path: 'Observation.component.code',
          min: 1,
          max: '1',
          patternCodeableConcept: {
            coding: [{ system: 'http://loinc.org', code: '48004-6' }],
          },
        } as ElementDefinition,
        {
          id: 'Observation.component:representative-coding-hgvs.value[x]',
          path: 'Observation.component.value[x]',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/uv/genomics-reporting/ValueSet/hgvs-vs',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        component: [{
          code: {
            coding: [{ system: 'http://loinc.org', code: '48004-6' }],
          },
          valueCodeableConcept: {
            coding: [{ system: 'http://varnomen.hgvs.org', code: 'NM_004333.4:c.1799T>A' }],
          },
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.component') return resource.component;
        return undefined;
      };
      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      const issues = await executor.validate(mockContext);

      expect(issues.some(issue => issue.code === 'binding-required-missing')).toBe(false);
      expect(validateBindingSpy).toHaveBeenCalledWith(
        mockContext.resource.component[0].valueCodeableConcept,
        expect.objectContaining({
          strength: 'required',
          valueSet: 'http://hl7.org/fhir/uv/genomics-reporting/ValueSet/hgvs-vs',
        }),
        'Observation.component.value[x]',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('applies sliced CodeableConcept bindings only to matching patternCodeableConcept values', async () => {
      const laboratoryCategory = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'laboratory',
        }],
      };
      const sectionTypeCategory = {
        coding: [{
          system: 'http://loinc.org',
          code: '22634-0',
        }],
      };

      mockStructureDef.snapshot!.element = [
        {
          id: 'Observation.category:laboratory-category',
          path: 'Observation.category',
          sliceName: 'laboratory-category',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
          patternCodeableConcept: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            }],
          },
          binding: {
            strength: 'preferred',
            valueSet: 'http://hl7.org/fhir/ValueSet/observation-category',
          },
        } as ElementDefinition,
        {
          id: 'Observation.category:section-type',
          path: 'Observation.category',
          sliceName: 'section-type',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'required',
            valueSet: 'http://example.org/fhir/ValueSet/patho-section-types-loinc',
          },
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        category: [laboratoryCategory, sectionTypeCategory],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.category') {
          return resource.category;
        }
        return undefined;
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).toHaveBeenCalledTimes(2);
      expect(validateBindingSpy).toHaveBeenNthCalledWith(
        1,
        laboratoryCategory,
        expect.objectContaining({
          valueSet: 'http://hl7.org/fhir/ValueSet/observation-category',
        }),
        'Observation.category',
        expect.any(Object),
      );
      expect(validateBindingSpy).toHaveBeenNthCalledWith(
        2,
        sectionTypeCategory,
        expect.objectContaining({
          valueSet: 'http://example.org/fhir/ValueSet/patho-section-types-loinc',
        }),
        'Observation.category',
        expect.any(Object),
      );
      validateBindingSpy.mockRestore();
    });

    it('does not apply binding-only slice bindings to every sibling value', async () => {
      const problemListCategory = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'problem-list-item',
        }],
      };

      mockStructureDef = {
        id: 'us-core-condition-problems-health-concerns',
        url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns',
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:problem-or-health-concern',
              path: 'Condition.category',
              sliceName: 'problem-or-health-concern',
              min: 1,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as ElementDefinition,
            {
              id: 'Condition.category:simple-observation',
              path: 'Condition.category',
              sliceName: 'simple-observation',
              min: 0,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
              },
            } as ElementDefinition,
          ],
        },
      };
      mockContext = {
        resource: {
          resourceType: 'Condition',
          category: [problemListCategory],
        },
        structureDef: mockStructureDef,
        getValueAtPath: (resource: any, path: string) => {
          if (path === 'Condition.category') return resource.category;
          return undefined;
        },
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
        }),
        expect.anything(),
        expect.anything(),
      );
      validateBindingSpy.mockRestore();
    });

    it('does not apply optional binding-only Coding slice bindings without a discriminator match', async () => {
      mockStructureDef = {
        id: 'Condition-twcore',
        url: 'https://twcore.mohw.gov.tw/ig/twcore/StructureDefinition/Condition-twcore',
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.code',
              path: 'Condition.code',
              min: 0,
              max: '1',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'example',
                valueSet: 'http://hl7.org/fhir/ValueSet/condition-code',
              },
            } as ElementDefinition,
            {
              id: 'Condition.code.coding',
              path: 'Condition.code.coding',
              min: 0,
              max: '*',
              type: [{ code: 'Coding' }],
            } as ElementDefinition,
            {
              id: 'Condition.code.coding:icd10-cm-2023',
              path: 'Condition.code.coding',
              sliceName: 'icd10-cm-2023',
              min: 0,
              max: '1',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'https://twcore.mohw.gov.tw/ig/twcore/ValueSet/icd-10-cm-2023-tw',
              },
            } as ElementDefinition,
            {
              id: 'Condition.code.coding:absentOrUnknownProblem',
              path: 'Condition.code.coding',
              sliceName: 'absentOrUnknownProblem',
              min: 0,
              max: '1',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/uv/ips/ValueSet/absent-or-unknown-problems-uv-ips',
              },
            } as ElementDefinition,
          ],
        },
      };
      mockContext = {
        resource: {
          resourceType: 'Condition',
          code: {
            coding: [{
              system: 'http://hl7.org/fhir/sid/icd-10-cm',
              code: 'I63.9',
              display: 'Cerebral infarction, unspecified',
            }],
          },
        },
        structureDef: mockStructureDef,
        getValueAtPath: (resource: any, path: string) => {
          if (path === 'Condition.code') return resource.code;
          if (path === 'Condition.code.coding') return resource.code.coding;
          return undefined;
        },
      };

      const validatorInstance = (executor as any).valuesetValidator;
      const validateBindingSpy = vi.spyOn(validatorInstance, 'validateBinding').mockResolvedValue([]);

      await executor.validate(mockContext);

      expect(validateBindingSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          valueSet: 'http://hl7.org/fhir/uv/ips/ValueSet/absent-or-unknown-problems-uv-ips',
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(validateBindingSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          valueSet: 'https://twcore.mohw.gov.tw/ig/twcore/ValueSet/icd-10-cm-2023-tw',
        }),
        expect.anything(),
        expect.anything(),
      );
      validateBindingSpy.mockRestore();
    });

    it('should handle nested CodeableConcept structures', async () => {
      mockContext.resource.code = {
        coding: [
          {
            system: 'http://loinc.org',
            code: '33747-0',
            display: 'Temperature'
          },
          {
            system: 'http://snomed.info/sct',
            code: '386053000',
            display: 'Body temperature'
          }
        ],
        text: 'Temperature measurement'
      };

      const issues = await executor.validate(mockContext);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should not append an extra coding segment for Coding element paths', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.code.coding',
          min: 0,
          max: '*',
          type: [{ code: 'Coding' }],
        } as ElementDefinition,
      ];
      mockContext.resource.code = {
        coding: [
          {
            system: 'http://example.org/fhir/CodeSystem/LabTests',
            code: 'GroßesBlutbild',
          },
        ],
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        code: 'not-found',
        path: 'Observation.code.coding[0].system',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        path: 'Observation.code.coding.coding[0].system',
      }));
    });

    it('warns when a Coding has a code but no system', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.value[x]',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        valueCodeableConcept: {
          coding: [{ code: 'ORIGINAL' }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.value[x]') return resource.valueCodeableConcept;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-coding-missing-system',
        path: 'Observation.value[x].coding[0]',
      }));
    });

    it('validates UCUM codings inside CodeableConcept values', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.value[x]',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        valueCodeableConcept: {
          coding: [{ system: 'http://unitsofmeasure.org', code: 'BQML' }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Observation.value[x]') return resource.valueCodeableConcept;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error',
        code: 'terminology-code-invalid',
        path: 'Observation.value[x].coding[0].code',
      }));
    });

    it('emits indexed UCUM Quantity paths without duplicate hygiene issues', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.referenceRange.low',
          min: 0,
          max: '1',
          type: [{ code: 'SimpleQuantity' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Observation',
        referenceRange: [
          { low: { value: 5, system: 'http://unitsofmeasure.org', code: 'pH' } },
          { low: { value: 6, system: 'http://unitsofmeasure.org', code: 'pH' } },
        ],
      };

      const issues = await executor.validate(mockContext);
      const invalidUcumIssues = issues.filter(issue => issue.code === 'terminology-code-invalid');

      expect(invalidUcumIssues).toHaveLength(2);
      expect(invalidUcumIssues).toContainEqual(expect.objectContaining({
        path: 'Observation.referenceRange[0].low.code',
      }));
      expect(invalidUcumIssues).toContainEqual(expect.objectContaining({
        path: 'Observation.referenceRange[1].low.code',
      }));
      expect(invalidUcumIssues).not.toContainEqual(expect.objectContaining({
        path: 'Observation.referenceRange.low.code',
      }));
    });

    it.each([
      ['mm Hg', 'mm[Hg]', 'millimeter of mercury'],
      ['days', 'd', 'day'],
      ['mcg', 'ug', 'microgram'],
      ['\u03bcmol/L', 'umol/L', 'micromole per liter'],
      ['Celcius', 'Cel', 'degree Celsius'],
    ])('adds common UCUM correction hints for %s', (invalidCode, suggestedCode, suggestedDisplay) => {
      const message = `${invalidCode} is not a valid UCUM code.`;

      expect(buildInvalidUcumIssueDetails(
        invalidCode,
        'Observation.valueQuantity.code',
        message,
      )).toEqual(expect.objectContaining({
        suggestedCode,
        suggestedDisplay,
        fixHint: expect.stringContaining(`'${suggestedCode}'`),
      }));
      expect(buildInvalidUcumMessage(
        invalidCode,
        'Observation.valueQuantity.code',
        message,
      )).toContain(`Use '${suggestedCode}' in Quantity.code.`);
    });

    it('adds information for UCUM Quantity codes that rely on human-readable annotations', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'MedicationStatement.dosage.doseAndRate.dose[x]',
          min: 0,
          max: '1',
          type: [{ code: 'Quantity' }],
        } as ElementDefinition,
      ];
      mockContext.structureDef.type = 'MedicationStatement';
      mockContext.resource = {
        resourceType: 'MedicationStatement',
        dosage: [{
          doseAndRate: [{
            doseQuantity: { value: 1, system: 'http://unitsofmeasure.org', code: '{tbl}' },
          }],
        }],
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'information',
        code: 'terminology-ucum-annotation',
        path: 'MedicationStatement.dosage[0].doseAndRate[0].doseQuantity.code',
      }));
    });

    it('adds information for UCUM Coding values that rely on human-readable annotations', async () => {
      mockStructureDef.snapshot!.element = [];
      mockContext.resource = {
        resourceType: 'Observation',
        valueCodeableConcept: {
          coding: [{ system: 'http://unitsofmeasure.org', code: '{tbl}' }],
        },
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'information',
        code: 'terminology-ucum-annotation',
        path: 'Observation.valueCodeableConcept.coding[0].code',
      }));
    });

    it('validates coding hygiene inside nested extension values', async () => {
      mockStructureDef.snapshot!.element = [];
      mockContext.resource = {
        resourceType: 'ImagingStudy',
        series: [{
          extension: [{
            extension: [{
              valueCodeableConcept: {
                coding: [
                  { system: 'http://unitsofmeasure.org', code: 'BQML' },
                  { code: 'ORIGINAL' },
                ],
              },
            }],
          }],
        }],
      };

      const issues = await executor.validate(mockContext);

      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error',
        code: 'terminology-code-invalid',
        path: 'ImagingStudy.series[0].extension[0].extension[0].valueCodeableConcept.coding[0].code',
      }));
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'warning',
        code: 'terminology-coding-missing-system',
        path: 'ImagingStudy.series[0].extension[0].extension[0].valueCodeableConcept.coding[1]',
      }));
    });

    it('does not treat terminology artifact concepts as bare Coding values', async () => {
      mockStructureDef.type = 'ValueSet';
      mockStructureDef.snapshot!.element = [];
      mockContext.resource = {
        resourceType: 'ValueSet',
        compose: {
          include: [{
            system: 'http://example.org/CodeSystem/test',
            concept: [
              { code: 'a', display: 'Alpha' },
              { code: 'b', display: 'Beta' },
            ],
          }],
        },
      };

      const issues = await executor.validate(mockContext);

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'terminology-code-invalid',
        path: 'ValueSet.compose.include[0].concept[0]',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'terminology-code-invalid',
        path: 'ValueSet.compose.include[0].concept[1]',
      }));
    });

    it('recognizes MII-adjacent IHE-D and EDQM CodeSystem URLs', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Observation.code',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource.code = {
        coding: [
          {
            system: 'http://ihe-d.de/CodeSystems/FallkontextBeiDokumentenerstellung',
            code: 'E210',
          },
          {
            system: 'http://standardterms.edqm.eu',
            code: '11210000',
          },
        ],
      };

      const issues = await executor.validate(mockContext);

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'not-found',
        path: 'Observation.code.coding[0].system',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'not-found',
        path: 'Observation.code.coding[1].system',
      }));
    });

    it('recognizes the CMS ICD-10-PCS CodeSystem URL from HL7 terminology', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Procedure.code',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Procedure',
        code: {
          coding: [{
            system: 'http://www.cms.gov/Medicare/Coding/ICD10',
            code: '00160J0',
          }],
        },
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Procedure.code') return resource.code;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'not-found',
        path: 'Procedure.code.coding[0].system',
      }));
    });

    it('recognizes standard external and national IG CodeSystem URLs', async () => {
      mockStructureDef.snapshot!.element = [
        {
          path: 'Encounter.hospitalization.dischargeDisposition',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
        {
          path: 'Encounter.serviceType',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
        {
          path: 'Condition.code',
          min: 0,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
        {
          path: 'Patient.communication.language',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
        {
          path: 'Patient.identifier.type',
          min: 0,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
        } as ElementDefinition,
      ];
      mockContext.resource = {
        resourceType: 'Patient',
        code: {
          coding: [{
            system: 'https://id.who.int/icd/release/11/2025-01/mms',
            code: '1F4Z',
          }],
        },
        hospitalization: {
          dischargeDisposition: {
            coding: [{
              system: 'http://www.nubc.org/patient-discharge',
              code: 'home',
            }],
          },
        },
        serviceType: {
          coding: [{
            system: 'https://snomed.info/sct',
            code: '394712000',
          }],
        },
        communication: [{
          language: {
            coding: [{
              system: 'https://fhir.hl7.org.uk/CodeSystem/UKCore-HumanLanguage',
              code: 'en',
            }],
          },
        }],
        identifier: [{
          type: {
            coding: [{
              system: 'https://hl7chile.cl/fhir/ig/clcore/CodeSystem/CSCodigoDNI',
              code: 'NNCHL',
            }],
          },
        }],
      };
      mockContext.getValueAtPath = (resource: any, path: string) => {
        if (path === 'Encounter.hospitalization.dischargeDisposition') {
          return resource.hospitalization.dischargeDisposition;
        }
        if (path === 'Encounter.serviceType') return resource.serviceType;
        if (path === 'Condition.code') return resource.code;
        if (path === 'Patient.communication.language') return resource.communication[0].language;
        if (path === 'Patient.identifier.type') return resource.identifier[0].type;
        return undefined;
      };

      const issues = await executor.validate(mockContext);

      expect(issues.filter(issue => issue.code === 'not-found')).toHaveLength(0);
    });
  });
});
