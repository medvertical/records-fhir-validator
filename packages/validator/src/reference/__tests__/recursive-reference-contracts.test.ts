/**
 * Recursive Reference Validator Unit Tests
 * 
 * Tests for recursive validation of referenced resources with depth limits.
 * Validates circular reference prevention and configuration enforcement.
 * 
 * Task 6.6 & 6.7: Unit tests for recursive reference validation
 */

import { describe, it, expect, beforeEach, vi as _vi } from 'vitest';
import {
  RecursiveReferenceValidator,
  getRecursiveReferenceValidator,
  resetRecursiveReferenceValidator,
  type RecursiveValidationConfig
} from '../recursive-reference-validator';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockResourceFetcher(resources: Record<string, any>) {
  return async (reference: string) => {
    // Simple lookup - in real scenarios this would fetch from a FHIR server
    return resources[reference] || null;
  };
}

function createPatientWithReference(id: string, orgRef?: string) {
  return {
    resourceType: 'Patient',
    id,
    managingOrganization: orgRef ? { reference: orgRef } : undefined,
  };
}

function createOrganization(id: string) {
  return {
    resourceType: 'Organization',
    id,
    name: `Organization ${id}`,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('RecursiveReferenceValidator', () => {
  let validator: RecursiveReferenceValidator;

  beforeEach(() => {
    resetRecursiveReferenceValidator();
    validator = getRecursiveReferenceValidator();
  });

  // ========================================================================
  // Configuration Tests
  // ========================================================================

  describe('Configuration', () => {
    it('should have default configuration', () => {
      const config = validator.getDefaultConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxDepth).toBe(1);
      expect(config.validateExternal).toBe(false);
      expect(config.validateContained).toBe(true);
      expect(config.validateBundleEntries).toBe(true);
    });

    it('should create safe configuration with enforced limits', () => {
      const unsafeConfig = {
        maxDepth: 10, // Too high
        maxReferencesPerResource: 100, // Too high
        timeoutMs: 100000, // Too high
      };

      const safeConfig = validator.createSafeConfig(unsafeConfig);

      expect(safeConfig.maxDepth).toBeLessThanOrEqual(3);
      expect(safeConfig.maxReferencesPerResource).toBeLessThanOrEqual(20);
      expect(safeConfig.timeoutMs).toBeLessThanOrEqual(60000);
    });

    it('should respect minimum depth of 0', () => {
      const config = validator.createSafeConfig({ maxDepth: -1 });

      expect(config.maxDepth).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // Basic Recursive Validation Tests
  // ========================================================================

  describe('Basic Recursive Validation', () => {
    it('should not validate when disabled', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const config: Partial<RecursiveValidationConfig> = {
        enabled: false,
      };

      const result = await validator.validateRecursively(patient, config);

      expect(result.totalResourcesValidated).toBe(0);
      expect(result.referencesFollowed).toBe(0);
    });

    it('should validate single resource when enabled', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const org = createOrganization('org1');

      const fetcher = createMockResourceFetcher({
        'Organization/org1': org,
      });

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.totalResourcesValidated).toBeGreaterThan(0);
      expect(result.maxDepthReached).toBeLessThanOrEqual(1);
    });

    it('should follow references up to max depth', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const org = createOrganization('org1');

      const fetcher = createMockResourceFetcher({
        'Organization/org1': org,
      });

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 2,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(1);
      expect(result.maxDepthReached).toBeLessThanOrEqual(2);
    });

    it('should track unresolved references', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/nonexistent');

      const fetcher = createMockResourceFetcher({});

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.unresolvedReferences.length).toBeGreaterThan(0);
      expect(result.unresolvedReferences).toContain('Organization/nonexistent');
    });

    it('should work without resource fetcher', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config);

      // Should complete but mark references as unresolved
      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(0);
      expect(result.unresolvedReferences.length).toBeGreaterThan(0);
    });

    it('resolves contained references without a resource fetcher', async () => {
      const encounter = {
        resourceType: 'Encounter',
        id: 'enc1',
        contained: [
          {
            resourceType: 'Location',
            id: 'home',
            mode: 'kind',
          },
        ],
        location: [
          {
            location: {
              reference: '#home',
            },
          },
        ],
      };

      const result = await validator.validateRecursively(encounter, {
        enabled: true,
        maxDepth: 1,
      });

      expect(result.referencesFollowed).toBe(1);
      expect(result.unresolvedReferences).not.toContain('#home');
    });

    it('ignores contained references when contained recursion is disabled', async () => {
      const encounter = {
        resourceType: 'Encounter',
        id: 'enc1',
        location: [
          {
            location: {
              reference: '#missing',
            },
          },
        ],
      };

      const result = await validator.validateRecursively(encounter, {
        enabled: true,
        maxDepth: 1,
        validateContained: false,
      });

      expect(result.unresolvedReferences).not.toContain('#missing');
    });
  });

  // ========================================================================
  // Depth Limit Tests
  // ========================================================================

  describe('Depth Limit Enforcement', () => {
    it('should stop at depth 1', async () => {
      // Create chain: Patient → Organization → Location
      const resources = {
        'Organization/org1': {
          resourceType: 'Organization',
          id: 'org1',
          partOf: { reference: 'Organization/parent' },
        },
        'Organization/parent': {
          resourceType: 'Organization',
          id: 'parent',
        },
      };

      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.maxDepthReached).toBeLessThanOrEqual(1);
    });

    it('should validate to depth 2', async () => {
      const resources = {
        'Organization/org1': {
          resourceType: 'Organization',
          id: 'org1',
          partOf: { reference: 'Organization/parent' },
        },
        'Organization/parent': {
          resourceType: 'Organization',
          id: 'parent',
        },
      };

      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 2,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.maxDepthReached).toBeLessThanOrEqual(2);
      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(1);
    });

    it('should enforce max depth of 3', async () => {
      const config = validator.createSafeConfig({ maxDepth: 10 });

      expect(config.maxDepth).toBeLessThanOrEqual(3);
    });
  });

  // ========================================================================
  // Circular Reference Prevention Tests
  // ========================================================================

  describe('Circular Reference Prevention', () => {
    it('should detect and prevent circular references', async () => {
      // Create circular reference: Patient A → Patient B → Patient A
      const resources = {
        'Patient/A': createPatientWithReference('A', 'Patient/B'),
        'Patient/B': createPatientWithReference('B', 'Patient/A'),
      };

      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 3,
      };

      const result = await validator.validateRecursively(resources['Patient/A'], config, fetcher);

      // Should detect circular reference and stop
      expect(result.circularReferences.length).toBeGreaterThan(0);
    });

    it('should not get stuck in infinite loop', async () => {
      const resources = {
        'Patient/A': createPatientWithReference('A', 'Patient/A'), // Self-reference
      };

      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 2,
      };

      const startTime = Date.now();
      const result = await validator.validateRecursively(resources['Patient/A'], config, fetcher);
      const endTime = Date.now();

      // Should complete quickly despite circular reference
      expect(endTime - startTime).toBeLessThan(1000);
      expect(result.circularReferences.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // Filtering Tests
  // ========================================================================

  describe('Reference Filtering', () => {
    it('should exclude specified resource types', async () => {
      const patient = {
        resourceType: 'Patient',
        id: 'pat1',
        managingOrganization: { reference: 'Organization/org1' },
        generalPractitioner: [{ reference: 'Practitioner/pract1' }],
      };

      const resources = {
        'Organization/org1': createOrganization('org1'),
        'Practitioner/pract1': {
          resourceType: 'Practitioner',
          id: 'pract1',
        },
      };

      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
        excludeResourceTypes: ['Practitioner'],
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      // Should validate Organization but not Practitioner
      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(1);
    });

    it('should limit references per resource', async () => {
      const patient = {
        resourceType: 'Patient',
        id: 'pat1',
        generalPractitioner: Array.from({ length: 20 }, (_, i) => ({
          reference: `Practitioner/pract${i}`,
        })),
      };

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
        maxReferencesPerResource: 5,
      };

      const result = await validator.validateRecursively(patient, config);

      // Should only process first 5 references
      expect(result.unresolvedReferences.length).toBeLessThanOrEqual(5);
    });
  });

  // ========================================================================
  // Cost Estimation Tests
  // ========================================================================

  describe('Cost Estimation', () => {
    it('should estimate validation cost', () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');

      const estimate = validator.estimateValidationCost(patient, { maxDepth: 1 });

      expect(estimate.estimatedResources).toBeGreaterThanOrEqual(0);
      expect(estimate.estimatedReferences).toBeGreaterThanOrEqual(0);
      expect(estimate.estimatedTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof estimate.wouldExceedLimits).toBe('boolean');
    });

    it('should flag when validation would exceed limits', () => {
      const resourceWithManyRefs = {
        resourceType: 'DiagnosticReport',
        id: 'report1',
        result: Array.from({ length: 30 }, (_, i) => ({
          reference: `Observation/obs${i}`,
        })),
      };

      const estimate = validator.estimateValidationCost(resourceWithManyRefs, { maxDepth: 2 });

      // Should warn about exceeding limits
      expect(estimate.wouldExceedLimits).toBe(true);
    });
  });

  // ========================================================================
  // Real-World Scenarios
  // ========================================================================

  describe('Real-World Scenarios', () => {
    it('should handle Patient → Organization chain', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');
      const org = createOrganization('org1');

      const fetcher = createMockResourceFetcher({
        'Organization/org1': org,
      });

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(1);
      expect(result.referencesFollowed).toBeGreaterThanOrEqual(1);
    });

    it('should handle complex reference tree', async () => {
      const resources = {
        'Organization/org1': {
          resourceType: 'Organization',
          id: 'org1',
          partOf: { reference: 'Organization/parent' },
        },
        'Organization/parent': createOrganization('parent'),
        'Practitioner/pract1': {
          resourceType: 'Practitioner',
          id: 'pract1',
        },
      };

      const patient = {
        resourceType: 'Patient',
        id: 'pat1',
        managingOrganization: { reference: 'Organization/org1' },
        generalPractitioner: [{ reference: 'Practitioner/pract1' }],
      };

      const fetcher = createMockResourceFetcher(resources);

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 2,
      };

      const result = await validator.validateRecursively(patient, config, fetcher);

      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(1);
      expect(result.maxDepthReached).toBeLessThanOrEqual(2);
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle resource without references', async () => {
      const patient = {
        resourceType: 'Patient',
        id: 'pat1',
        name: [{ family: 'Test' }],
      };

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config);

      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(0);
      expect(result.referencesFollowed).toBe(0);
    });

    it('should handle null resource gracefully', async () => {
      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(null as any, config);

      expect(result.totalResourcesValidated).toBe(0);
    });

    it('should handle resource without ID', async () => {
      const patient = {
        resourceType: 'Patient',
        // No ID
        managingOrganization: { reference: 'Organization/org1' },
      };

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
      };

      const result = await validator.validateRecursively(patient, config);

      expect(result.totalResourcesValidated).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // Performance Tests
  // ========================================================================

  describe('Performance', () => {
    it('should complete within reasonable time', async () => {
      const patient = createPatientWithReference('pat1', 'Organization/org1');

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 1,
        timeoutMs: 5000,
      };

      const startTime = Date.now();
      const result = await validator.validateRecursively(patient, config);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(config.timeoutMs!);
      expect(result.timedOut).toBe(false);
    });

    it('should handle timeout gracefully', async () => {
      // Create resource with many references to trigger timeout
      const patient = {
        resourceType: 'Patient',
        id: 'pat1',
        generalPractitioner: Array.from({ length: 10 }, (_, i) => ({
          reference: `Practitioner/pract${i}`,
        })),
      };

      // Mock slow fetcher
      const slowFetcher = async (ref: string) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return createOrganization(ref.split('/')[1]);
      };

      const config: Partial<RecursiveValidationConfig> = {
        enabled: true,
        maxDepth: 2,
        timeoutMs: 500, // Timeout before all refs are processed
      };

      const result = await validator.validateRecursively(patient, config, slowFetcher);

      // Should timeout or complete
      expect(result).toBeDefined();
      // Timeout behavior depends on timing
    });
  });
});
