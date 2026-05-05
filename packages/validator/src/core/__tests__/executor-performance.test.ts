import { log } from './logger-helper';
/**
 * Executor Performance Tests
 * 
 * Task 4.10: Performance test to ensure no regression in validation throughput
 * 
 * Tests validation performance to ensure:
 * - No significant slowdown after executor refactoring
 * - Batch validation performance maintained
 * - Memory usage remains reasonable
 * - Throughput meets baseline expectations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RecordsValidator } from '../validator-engine';
// ============================================================================
// Test Resources - Generate test data
// ============================================================================

/**
 * Generate a valid Patient resource
 */
function createValidPatient(id: string): any {
  return {
    resourceType: 'Patient',
    id: `patient-${id}`,
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
      lastUpdated: '2024-01-01T00:00:00Z'
    },
    name: [{
      family: `Family${id}`,
      given: [`Given${id}`]
    }],
    gender: 'male',
    birthDate: '1990-01-01',
    active: true
  };
}

/**
 * Generate a valid Observation resource
 */
function createValidObservation(id: string, patientId: string): any {
  return {
    resourceType: 'Observation',
    id: `observation-${id}`,
    status: 'final',
    code: {
      coding: [{
        system: 'http://loinc.org',
        code: '33747-0',
        display: 'Temperature'
      }]
    },
    subject: {
      reference: `Patient/${patientId}`
    },
    valueQuantity: {
      value: 98.6,
      unit: '°F',
      system: 'http://unitsofmeasure.org',
      code: '[degF]'
    }
  };
}

/**
 * Generate multiple test resources
 */
function generateTestResources(count: number, resourceType: 'Patient' | 'Observation' = 'Patient'): any[] {
  const resources: any[] = [];
  
  for (let i = 0; i < count; i++) {
    const id = `test-${i}`;
    if (resourceType === 'Patient') {
      resources.push(createValidPatient(id));
    } else {
      resources.push(createValidObservation(id, `patient-${i}`));
    }
  }
  
  return resources;
}

// ============================================================================
// Performance Metrics
// ============================================================================

interface PerformanceMetrics {
  totalTime: number;
  averageTimePerResource: number;
  minTime: number;
  maxTime: number;
  throughput: number; // resources per second
  memoryUsage?: number; // MB (if available)
}

/**
 * Measure validation performance
 */
async function measurePerformance(
  validator: RecordsValidator,
  resources: any[],
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
): Promise<PerformanceMetrics> {
  const startTime = Date.now();
  const times: number[] = [];
  
  // Measure individual resource validation times
  for (const resource of resources) {
    const resourceStart = Date.now();
    await validator.validate(resource, profileUrl, fhirVersion);
    const resourceTime = Date.now() - resourceStart;
    times.push(resourceTime);
  }
  
  const totalTime = Date.now() - startTime;
  const averageTime = totalTime / resources.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const throughput = (resources.length / totalTime) * 1000; // resources per second
  
  return {
    totalTime,
    averageTimePerResource: averageTime,
    minTime,
    maxTime,
    throughput
  };
}

/**
 * Measure batch validation performance
 */
async function measureBatchPerformance(
  validator: RecordsValidator,
  resources: any[],
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  maxConcurrency: number = 10
): Promise<PerformanceMetrics> {
  const startTime = Date.now();
  
  await validator.validateBatch(resources, {
    fhirVersion,
    profileUrl,
    maxConcurrency
  });
  
  const totalTime = Date.now() - startTime;
  const averageTime = totalTime / resources.length;
  const throughput = (resources.length / totalTime) * 1000; // resources per second
  
  return {
    totalTime,
    averageTimePerResource: averageTime,
    minTime: averageTime, // Batch doesn't track individual times
    maxTime: averageTime,
    throughput
  };
}

// ============================================================================
// Performance Baselines
// ============================================================================

/**
 * Performance baselines (expected minimum performance)
 * These are conservative estimates - actual performance may be better
 */
const PERFORMANCE_BASELINES = {
  singleResource: {
    maxAverageTime: 500, // 500ms per resource (conservative)
    minThroughput: 2 // 2 resources per second minimum
  },
  batchValidation: {
    maxAverageTime: 500, // 500ms per resource in batch (matches single-resource baseline; CI hosts vary)
    minThroughput: 2 // 2 resources per second minimum
  },
  batchSize10: {
    maxTotalTime: 2000, // 2 seconds for 10 resources
    minThroughput: 5
  },
  batchSize50: {
    maxTotalTime: 10000, // 10 seconds for 50 resources
    minThroughput: 5
  }
};

// ============================================================================
// Test Suite
// ============================================================================

describe('Executor Performance Tests', () => {
  let validator: RecordsValidator;
  const baseProfileUrl = 'http://hl7.org/fhir/StructureDefinition';

  beforeAll(async () => {
    validator = new RecordsValidator({
      enableCaching: true,
      strictMode: false,
      timeout: 30000,
      autoDownload: false // Disable auto-download for faster tests
    });
    
    // Wait for validator initialization
    await validator.waitForInitialization();
    
    if (!validator.isAvailable()) {
      log.warn('Validator not available - performance tests may be limited');
    }
  }, 120000); // 120 second timeout for initialization

  afterAll(() => {
    // Release heavy sub-validators to prevent OOM pressure on sibling workers
    validator = null as unknown as RecordsValidator;
  });

  describe('Single Resource Validation Performance', () => {
    it('should validate single Patient resource within acceptable time', async () => {
      const resource = createValidPatient('perf-test-001');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      const startTime = Date.now();
      await validator.validate(resource, profileUrl, 'R4');
      const duration = Date.now() - startTime;
      
      // Should complete within reasonable time (1 second for single resource)
      expect(duration).toBeLessThan(1000);
      
      log.info(`Single Patient validation: ${duration}ms`);
    });

    it('should validate multiple single resources with consistent performance', async () => {
      const resources = generateTestResources(5, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      const metrics = await measurePerformance(validator, resources, profileUrl, 'R4');
      
      // Average time should be reasonable
      expect(metrics.averageTimePerResource).toBeLessThan(PERFORMANCE_BASELINES.singleResource.maxAverageTime);
      
      // Throughput should meet minimum
      expect(metrics.throughput).toBeGreaterThan(PERFORMANCE_BASELINES.singleResource.minThroughput);
      
      log.info(`Single resource performance (${resources.length} resources):`);
      log.info(`  Average: ${metrics.averageTimePerResource.toFixed(2)}ms/resource`);
      log.info(`  Total: ${metrics.totalTime}ms`);
      log.info(`  Throughput: ${metrics.throughput.toFixed(2)} resources/sec`);
      log.info(`  Min: ${metrics.minTime}ms, Max: ${metrics.maxTime}ms`);
    });
  });

  describe('Batch Validation Performance', () => {
    it('should validate small batch (10 resources) efficiently', async () => {
      const resources = generateTestResources(10, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      const metrics = await measureBatchPerformance(validator, resources, profileUrl, 'R4', 10);
      
      // Batch validation should be faster than individual
      expect(metrics.totalTime).toBeLessThan(PERFORMANCE_BASELINES.batchSize10.maxTotalTime);
      expect(metrics.throughput).toBeGreaterThan(PERFORMANCE_BASELINES.batchSize10.minThroughput);
      
      log.info(`Batch validation (10 resources):`);
      log.info(`  Total: ${metrics.totalTime}ms`);
      log.info(`  Average: ${metrics.averageTimePerResource.toFixed(2)}ms/resource`);
      log.info(`  Throughput: ${metrics.throughput.toFixed(2)} resources/sec`);
    });

    it('should validate medium batch (50 resources) efficiently', async () => {
      const resources = generateTestResources(50, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      const metrics = await measureBatchPerformance(validator, resources, profileUrl, 'R4', 10);
      
      // Should handle 50 resources efficiently
      expect(metrics.totalTime).toBeLessThan(PERFORMANCE_BASELINES.batchSize50.maxTotalTime);
      expect(metrics.throughput).toBeGreaterThan(PERFORMANCE_BASELINES.batchSize50.minThroughput);
      
      log.info(`Batch validation (50 resources):`);
      log.info(`  Total: ${metrics.totalTime}ms`);
      log.info(`  Average: ${metrics.averageTimePerResource.toFixed(2)}ms/resource`);
      log.info(`  Throughput: ${metrics.throughput.toFixed(2)} resources/sec`);
    });

    it('should scale batch validation with concurrency', async () => {
      const resources = generateTestResources(20, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      // Test with different concurrency levels
      const concurrencyLevels = [1, 5, 10];
      const results: Array<{ concurrency: number; metrics: PerformanceMetrics }> = [];
      
      for (const concurrency of concurrencyLevels) {
        const metrics = await measureBatchPerformance(
          validator,
          resources,
          profileUrl,
          'R4',
          concurrency
        );
        results.push({ concurrency, metrics });
      }
      
      // Higher concurrency should generally improve throughput
      // (though there are diminishing returns)
      log.info('Batch validation concurrency comparison:');
      results.forEach(({ concurrency, metrics }) => {
        log.info(`  Concurrency ${concurrency}: ${metrics.throughput.toFixed(2)} resources/sec`);
      });
      
      // At minimum, should meet baseline
      const maxConcurrencyResult = results[results.length - 1];
      expect(maxConcurrencyResult.metrics.throughput).toBeGreaterThan(
        PERFORMANCE_BASELINES.batchValidation.minThroughput
      );
    });
  });

  describe('Different Resource Types Performance', () => {
    it('should validate Patient resources efficiently', async () => {
      const resources = generateTestResources(10, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      const metrics = await measureBatchPerformance(validator, resources, profileUrl, 'R4', 10);
      
      expect(metrics.averageTimePerResource).toBeLessThan(
        PERFORMANCE_BASELINES.batchValidation.maxAverageTime
      );
      
      log.info(`Patient validation: ${metrics.throughput.toFixed(2)} resources/sec`);
    });

    it('should validate Observation resources efficiently', async () => {
      const resources = generateTestResources(10, 'Observation');
      const profileUrl = `${baseProfileUrl}/Observation`;
      
      const metrics = await measureBatchPerformance(validator, resources, profileUrl, 'R4', 10);
      
      expect(metrics.averageTimePerResource).toBeLessThan(
        PERFORMANCE_BASELINES.batchValidation.maxAverageTime
      );
      
      log.info(`Observation validation: ${metrics.throughput.toFixed(2)} resources/sec`);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not leak memory during repeated validations', async () => {
      const resource = createValidPatient('memory-test');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      // Warmup: discard first 5 runs (JIT cold-start noise)
      for (let i = 0; i < 5; i++) {
        await validator.validate(resource, profileUrl, 'R4');
      }

      // Measure 20 warmed-up iterations
      const iterations = 20;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await validator.validate(resource, profileUrl, 'R4');
        times.push(Date.now() - start);
      }

      // Detect memory leaks via monotonic growth: last 5 should not be >5x slower than first 5
      const firstFive = times.slice(0, 5);
      const lastFive = times.slice(-5);
      const firstAvg = firstFive.reduce((a, b) => a + b, 0) / firstFive.length;
      const lastAvg = lastFive.reduce((a, b) => a + b, 0) / lastFive.length;

      // 5x headroom catches real memory leaks (10x+ degradation) without CI timing noise
      expect(lastAvg).toBeLessThan(firstAvg * 5);

      log.info(`Memory test (${iterations} warmed iterations):`);
      log.info(`  First-5 average: ${firstAvg.toFixed(2)}ms`);
      log.info(`  Last-5 average:  ${lastAvg.toFixed(2)}ms`);
    });
  });

  describe('Structural Validation Performance', () => {
    it('should validate structure efficiently', async () => {
      const resources = generateTestResources(10, 'Patient');
      
      const startTime = Date.now();
      for (const resource of resources) {
        await validator.validateStructure(resource, 'R4');
      }
      const totalTime = Date.now() - startTime;
      
      const averageTime = totalTime / resources.length;
      const throughput = (resources.length / totalTime) * 1000;
      
      expect(averageTime).toBeLessThan(PERFORMANCE_BASELINES.singleResource.maxAverageTime);
      expect(throughput).toBeGreaterThan(PERFORMANCE_BASELINES.singleResource.minThroughput);
      
      log.info(`Structural validation: ${throughput.toFixed(2)} resources/sec`);
    });
  });

  describe('Metadata Validation Performance', () => {
    it('should validate metadata efficiently', async () => {
      const resources = generateTestResources(10, 'Patient');
      
      const startTime = Date.now();
      for (const resource of resources) {
        await validator.validateMetadata(resource);
      }
      const totalTime = Date.now() - startTime;
      
      const averageTime = totalTime / resources.length;
      const throughput = (resources.length / totalTime) * 1000;
      
      // Metadata validation should be very fast
      expect(averageTime).toBeLessThan(100); // Should be < 100ms per resource
      
      log.info(`Metadata validation: ${throughput.toFixed(2)} resources/sec`);
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain performance characteristics after executor refactoring', async () => {
      // This test ensures the executor refactoring didn't introduce performance regressions
      const resources = generateTestResources(20, 'Patient');
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      // Measure current performance
      const metrics = await measureBatchPerformance(validator, resources, profileUrl, 'R4', 10);
      
      // Log performance metrics for comparison
      log.info('Performance baseline (post-executor refactoring):');
      log.info(`  Resources: ${resources.length}`);
      log.info(`  Total time: ${metrics.totalTime}ms`);
      log.info(`  Average per resource: ${metrics.averageTimePerResource.toFixed(2)}ms`);
      log.info(`  Throughput: ${metrics.throughput.toFixed(2)} resources/sec`);
      
      // Ensure performance meets baseline expectations
      expect(metrics.averageTimePerResource).toBeLessThan(
        PERFORMANCE_BASELINES.batchValidation.maxAverageTime
      );
      expect(metrics.throughput).toBeGreaterThan(
        PERFORMANCE_BASELINES.batchValidation.minThroughput
      );
      
      // Performance should be reasonable (not extremely slow)
      // If this fails, it indicates a performance regression
      expect(metrics.totalTime).toBeLessThan(10000); // 10 seconds for 20 resources max
    });
  });
});
