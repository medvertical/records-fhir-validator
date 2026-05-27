/**
 * Type Integrity Tests
 * 
 * Ensures that validation types can be properly serialized/deserialized
 * (DTO round-trip) and maintain type safety across boundaries.
 * 
 * Task 6.9: Type integrity (DTO serialization), no circular deps in CI
 */

import { describe, it, expect } from 'vitest';
import type {
  ValidationIssue,
  ValidationResult,
  ValidationSettings,
  ValidationAspectConfig,
  ValidationAspect,
  ValidationSeverity,
  ValidationProgress,
  ValidationSettingsUpdate
} from '../index';
import { normalizeValidationAspect, normalizeValidationSettings } from '../index';
import { safeParseSettingsUpdate } from '../settings-schema';

describe('Type Integrity - DTO Serialization', () => {
  describe('ValidationIssue', () => {
    it('should serialize and deserialize ValidationIssue correctly', () => {
      const issue: ValidationIssue = {
        id: 'issue-001',
        aspect: 'structural',
        severity: 'error',
        code: 'required-field-missing',
        message: 'Required field is missing',
        path: 'Patient.name',
        timestamp: new Date('2024-01-01T00:00:00Z')
      };

      // Serialize to JSON
      const json = JSON.stringify(issue);
      expect(json).toBeTruthy();

      // Deserialize from JSON
      const deserialized = JSON.parse(json) as ValidationIssue;
      expect(deserialized.id).toBe('issue-001');
      expect(deserialized.aspect).toBe('structural');
      expect(deserialized.severity).toBe('error');
      expect(deserialized.code).toBe('required-field-missing');
      expect(deserialized.message).toBe('Required field is missing');
      expect(deserialized.path).toBe('Patient.name');
      expect(new Date(deserialized.timestamp).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should handle optional fields in ValidationIssue', () => {
      const minimalIssue: ValidationIssue = {
        aspect: 'profile',
        severity: 'warning',
        message: 'Profile validation warning',
        path: ''
      };

      const json = JSON.stringify(minimalIssue);
      const deserialized = JSON.parse(json) as ValidationIssue;
      expect(deserialized.aspect).toBe('profile');
      expect(deserialized.severity).toBe('warning');
      expect(deserialized.message).toBe('Profile validation warning');
    });
  });

  describe('ValidationResult', () => {
    it('should serialize and deserialize ValidationResult correctly', () => {
      const result: ValidationResult = {
        resourceId: 'patient-001',
        resourceType: 'Patient',
        isValid: false,
        issues: [
          {
            aspect: 'structural',
            severity: 'error',
            message: 'Missing required field',
            path: 'Patient.name'
          }
        ],
        aspects: [
          {
            aspect: 'structural',
            isValid: false,
            issues: [
              {
                aspect: 'structural',
                severity: 'error',
                message: 'Missing required field',
                path: 'Patient.name'
              }
            ],
            validationTime: 150,
            status: 'completed'
          }
        ],
        validatedAt: new Date('2024-01-01T00:00:00Z'),
        validationTime: 150,
        fhirVersion: 'R4'
      };

      const json = JSON.stringify(result);
      const deserialized = JSON.parse(json) as ValidationResult;

      expect(deserialized.resourceId).toBe('patient-001');
      expect(deserialized.resourceType).toBe('Patient');
      expect(deserialized.isValid).toBe(false);
      expect(deserialized.issues).toHaveLength(1);
      expect(deserialized.aspects).toHaveLength(1);
      expect(deserialized.validationTime).toBe(150);
      expect(deserialized.fhirVersion).toBe('R4');
    });

    it('should handle empty ValidationResult', () => {
      const emptyResult: ValidationResult = {
        resourceId: 'test-001',
        resourceType: 'Patient',
        isValid: true,
        issues: [],
        aspects: [],
        validatedAt: new Date(),
        validationTime: 0
      };

      const json = JSON.stringify(emptyResult);
      const deserialized = JSON.parse(json) as ValidationResult;

      expect(deserialized.isValid).toBe(true);
      expect(deserialized.issues).toHaveLength(0);
      expect(deserialized.aspects).toHaveLength(0);
    });
  });

  describe('ValidationSettings', () => {
    it('should serialize and deserialize ValidationSettings correctly', () => {
      const settings: ValidationSettings = {
        aspects: {
          structural: { enabled: true, severity: 'error' },
          profile: { enabled: true, severity: 'warning' },
          terminology: { enabled: true, severity: 'warning' },
          reference: { enabled: true, severity: 'error' },
          invariant: { enabled: true, severity: 'error' },
          custom_rule: { enabled: true, severity: 'error' },
          metadata: { enabled: true, severity: 'error' },
          anomaly: { enabled: true, severity: 'info' }
        },
        performance: {
          maxConcurrent: 10,
          batchSize: 50
        },
        resourceTypes: {
          enabled: false,
          includedTypes: [],
          excludedTypes: []
        }
      };

      const json = JSON.stringify(settings);
      const deserialized = JSON.parse(json) as ValidationSettings;

      expect(deserialized.aspects.structural.enabled).toBe(true);
      expect(deserialized.aspects.structural.severity).toBe('error');
      expect(deserialized.performance.maxConcurrent).toBe(10);
      expect(deserialized.performance.batchSize).toBe(50);
      expect(deserialized.resourceTypes.enabled).toBe(false);
    });

    it('should handle ValidationSettings with resource type filtering', () => {
      const settings: ValidationSettings = {
        aspects: {
          structural: { enabled: true, severity: 'inherit' },
          profile: { enabled: true, severity: 'inherit' },
          terminology: { enabled: true, severity: 'inherit' },
          reference: { enabled: true, severity: 'inherit' },
          invariant: { enabled: true, severity: 'inherit' },
          custom_rule: { enabled: true, severity: 'inherit' },
          metadata: { enabled: true, severity: 'inherit' },
          anomaly: { enabled: true, severity: 'inherit' }
        },
        performance: {
          maxConcurrent: 5,
          batchSize: 25
        },
        resourceTypes: {
          enabled: true,
          includedTypes: ['Patient', 'Observation', 'Condition'],
          excludedTypes: ['Binary']
        }
      };

      const json = JSON.stringify(settings);
      const deserialized = JSON.parse(json) as ValidationSettings;

      expect(deserialized.resourceTypes.enabled).toBe(true);
      expect(deserialized.resourceTypes.includedTypes).toEqual(['Patient', 'Observation', 'Condition']);
      expect(deserialized.resourceTypes.excludedTypes).toEqual(['Binary']);
    });
  });

  describe('ValidationSettingsUpdate', () => {
    it('should serialize and deserialize ValidationSettingsUpdate correctly', () => {
      const update: ValidationSettingsUpdate = {
        aspects: {
          structural: { enabled: false }
        },
        performance: {
          maxConcurrent: 20
        }
      };

      const json = JSON.stringify(update);
      const deserialized = JSON.parse(json) as ValidationSettingsUpdate;

      expect(deserialized.aspects?.structural?.enabled).toBe(false);
      expect(deserialized.performance?.maxConcurrent).toBe(20);
    });

    it('leaves unknown aspect aliases untouched instead of accepting legacy customRule updates', () => {
      const legacyUpdate = {
        aspects: {
          customRule: { enabled: false, severity: 'warning' }
        }
      };

      const normalized = normalizeValidationSettings(legacyUpdate) as { aspects: Record<string, unknown> };
      expect(normalized.aspects.custom_rule).toBeUndefined();
      expect(normalized.aspects.customRule).toEqual({ enabled: false, severity: 'warning' });
    });

    it('rejects legacy customRule settings update payloads in the Zod parser', () => {
      const result = safeParseSettingsUpdate({
        aspects: {
          customRule: { enabled: false }
        }
      });

      expect(result.success).toBe(false);
    });

    it('does not normalize business rule aliases to custom_rule', () => {
      expect(normalizeValidationAspect('businessRule')).toBe('businessRule');
      expect(normalizeValidationAspect('business-rules')).toBe('business-rules');
      expect(normalizeValidationAspect('custom_rule')).toBe('custom_rule');
    });
  });

  describe('ValidationProgress', () => {
    it('should serialize and deserialize ValidationProgress correctly', () => {
      const progress: ValidationProgress = {
        jobId: 'job-001',
        status: 'running',
        totalResources: 100,
        processedResources: 50,
        validResources: 45,
        invalidResources: 5,
        startTime: new Date('2024-01-01T00:00:00Z'),
        lastUpdateTime: new Date('2024-01-01T00:05:00Z'),
        estimatedTimeRemaining: 300000
      };

      const json = JSON.stringify(progress);
      const deserialized = JSON.parse(json) as ValidationProgress;

      expect(deserialized.jobId).toBe('job-001');
      expect(deserialized.status).toBe('running');
      expect(deserialized.totalResources).toBe(100);
      expect(deserialized.processedResources).toBe(50);
      expect(deserialized.validResources).toBe(45);
      expect(deserialized.invalidResources).toBe(5);
      expect(deserialized.estimatedTimeRemaining).toBe(300000);
    });
  });

  describe('Type Safety - Enum Values', () => {
    it('should enforce ValidationAspect enum values', () => {
      const validAspects: ValidationAspect[] = [
        'structural',
        'profile',
        'terminology',
        'reference',
        'invariant',
        'custom_rule',
        'metadata',
        'anomaly'
      ];

      validAspects.forEach(aspect => {
        const issue: ValidationIssue = {
          aspect,
          severity: 'error',
          message: 'Test',
          path: ''
        };
        expect(issue.aspect).toBe(aspect);
      });
    });

    it('should enforce ValidationSeverity enum values', () => {
      const validSeverities: ValidationSeverity[] = [
        'inherit',
        'error',
        'warning',
        'info'
      ];

      validSeverities.forEach(severity => {
        const config: ValidationAspectConfig = {
          enabled: true,
          severity
        };
        expect(config.severity).toBe(severity);
      });
    });
  });

  describe('Cross-Boundary Type Safety', () => {
    it('should maintain type safety when passing ValidationResult through API boundary', () => {
      // Simulate API response
      const apiResponse = {
        resourceId: 'test-001',
        resourceType: 'Patient',
        isValid: true,
        issues: [],
        aspects: [],
        validatedAt: new Date().toISOString(),
        validationTime: 100,
        fhirVersion: 'R4'
      };

      // Type assertion (simulating API deserialization)
      const result = apiResponse as ValidationResult;
      expect(result.resourceId).toBe('test-001');
      expect(result.resourceType).toBe('Patient');
      expect(result.isValid).toBe(true);
    });

    it('should maintain type safety when passing ValidationSettings through API boundary', () => {
      const apiResponse = {
        aspects: {
          structural: { enabled: true, severity: 'error' },
          profile: { enabled: true, severity: 'warning' },
          terminology: { enabled: true, severity: 'warning' },
          reference: { enabled: true, severity: 'error' },
          invariant: { enabled: true, severity: 'error' },
          custom_rule: { enabled: true, severity: 'error' },
          metadata: { enabled: true, severity: 'error' },
          anomaly: { enabled: true, severity: 'info' }
        },
        performance: {
          maxConcurrent: 10,
          batchSize: 50
        },
        resourceTypes: {
          enabled: false,
          includedTypes: [],
          excludedTypes: []
        }
      };

      const settings = apiResponse as ValidationSettings;
      expect(settings.aspects.structural.enabled).toBe(true);
      expect(settings.performance.maxConcurrent).toBe(10);
    });
  });

  describe('Nested Object Serialization', () => {
    it('should handle deeply nested ValidationResult structures', () => {
      const complexResult: ValidationResult = {
        resourceId: 'complex-001',
        resourceType: 'Bundle',
        isValid: false,
        issues: [
          {
            aspect: 'structural',
            severity: 'error',
            message: 'Error 1',
            path: 'Bundle.entry[0]'
          },
          {
            aspect: 'profile',
            severity: 'warning',
            message: 'Warning 1',
            path: 'Bundle.entry[1]'
          }
        ],
        aspects: [
          {
            aspect: 'structural',
            isValid: false,
            issues: [
              {
                aspect: 'structural',
                severity: 'error',
                message: 'Error 1',
                path: 'Bundle.entry[0]'
              }
            ],
            validationTime: 200,
            status: 'completed'
          },
          {
            aspect: 'profile',
            isValid: false,
            issues: [
              {
                aspect: 'profile',
                severity: 'warning',
                message: 'Warning 1',
                path: 'Bundle.entry[1]'
              }
            ],
            validationTime: 150,
            status: 'completed'
          }
        ],
        validatedAt: new Date(),
        validationTime: 350
      };

      const json = JSON.stringify(complexResult);
      const deserialized = JSON.parse(json) as ValidationResult;

      expect(deserialized.issues).toHaveLength(2);
      expect(deserialized.aspects).toHaveLength(2);
      expect(deserialized.aspects[0].issues).toHaveLength(1);
      expect(deserialized.aspects[1].issues).toHaveLength(1);
    });
  });
});
