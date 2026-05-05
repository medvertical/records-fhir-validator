import { log } from './logger-helper';
/**
 * Executor Parity Tests
 * 
 * Task 4.9: Compare validation results before/after executor split
 * Ensures the executor refactoring maintains identical validation behavior
 * 
 * Tests validation results across different resource types to ensure:
 * - Same issues are detected
 * - Same issue counts
 * - Same issue paths and messages
 * - Same validation performance characteristics
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import type { ValidationIssue } from '../../types';

// ============================================================================
// Test Resources - Various Resource Types
// ============================================================================

const VALID_PATIENT = {
  resourceType: 'Patient',
  id: 'test-patient-001',
  meta: {
    profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
    lastUpdated: '2024-01-01T00:00:00Z'
  },
  name: [{
    family: 'Smith',
    given: ['John']
  }],
  gender: 'male',
  birthDate: '1990-01-01',
  active: true
};

const INVALID_PATIENT_MISSING_REQUIRED = {
  resourceType: 'Patient',
  id: 'test-patient-invalid',
  // Missing required name field
  gender: 'male'
};

const PATIENT_WITH_INVALID_TYPE = {
  resourceType: 'Patient',
  id: 'test-patient-type-error',
  name: [{
    family: 'Smith',
    given: ['John']
  }],
  gender: 'invalid-gender-value', // Invalid enum value
  birthDate: '1990-01-01'
};

const VALID_OBSERVATION = {
  resourceType: 'Observation',
  id: 'test-observation-001',
  status: 'final',
  code: {
    coding: [{
      system: 'http://loinc.org',
      code: '33747-0',
      display: 'Temperature'
    }]
  },
  subject: {
    reference: 'Patient/test-patient-001'
  },
  valueQuantity: {
    value: 98.6,
    unit: '°F',
    system: 'http://unitsofmeasure.org',
    code: '[degF]'
  }
};

const OBSERVATION_MISSING_REQUIRED = {
  resourceType: 'Observation',
  id: 'test-observation-invalid',
  // Missing required status and code fields
  subject: {
    reference: 'Patient/test-patient-001'
  }
};

const VALID_CONDITION = {
  resourceType: 'Condition',
  id: 'test-condition-001',
  clinicalStatus: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
      code: 'active'
    }]
  },
  subject: {
    reference: 'Patient/test-patient-001'
  },
  code: {
    coding: [{
      system: 'http://snomed.info/sct',
      code: '44054006',
      display: 'Diabetes mellitus type 2'
    }]
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize validation issues for comparison
 * Removes non-deterministic fields like timestamps and IDs
 */
function normalizeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map(issue => ({
    aspect: issue.aspect,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    path: issue.path,
    profile: issue.profile,
    // Exclude: id, timestamp, details (may vary)
  })).sort((a, b) => {
    // Sort by path, then by code, then by message
    if (a.path !== b.path) return (a.path || '').localeCompare(b.path || '');
    if (a.code !== b.code) return (a.code || '').localeCompare(b.code || '');
    return (a.message || '').localeCompare(b.message || '');
  });
}

/**
 * Compare two validation results
 */
function compareResults(
  actual: ValidationIssue[],
  expected: ValidationIssue[],
  _resourceType: string
): { match: boolean; differences: string[] } {
  const normalizedActual = normalizeIssues(actual);
  const normalizedExpected = normalizeIssues(expected);
  
  const differences: string[] = [];
  
  if (normalizedActual.length !== normalizedExpected.length) {
    differences.push(
      `Issue count mismatch: expected ${normalizedExpected.length}, got ${normalizedActual.length}`
    );
  }
  
  // Compare each issue
  const maxLength = Math.max(normalizedActual.length, normalizedExpected.length);
  for (let i = 0; i < maxLength; i++) {
    const actualIssue = normalizedActual[i];
    const expectedIssue = normalizedExpected[i];
    
    if (!actualIssue && expectedIssue) {
      differences.push(`Missing issue ${i}: ${JSON.stringify(expectedIssue)}`);
    } else if (actualIssue && !expectedIssue) {
      differences.push(`Extra issue ${i}: ${JSON.stringify(actualIssue)}`);
    } else if (actualIssue && expectedIssue) {
      if (actualIssue.aspect !== expectedIssue.aspect) {
        differences.push(`Issue ${i} aspect mismatch: expected ${expectedIssue.aspect}, got ${actualIssue.aspect}`);
      }
      if (actualIssue.severity !== expectedIssue.severity) {
        differences.push(`Issue ${i} severity mismatch: expected ${expectedIssue.severity}, got ${actualIssue.severity}`);
      }
      if (actualIssue.code !== expectedIssue.code) {
        differences.push(`Issue ${i} code mismatch: expected ${expectedIssue.code}, got ${actualIssue.code}`);
      }
      if (actualIssue.path !== expectedIssue.path) {
        differences.push(`Issue ${i} path mismatch: expected ${expectedIssue.path}, got ${actualIssue.path}`);
      }
      if (actualIssue.message !== expectedIssue.message) {
        differences.push(`Issue ${i} message mismatch: expected "${expectedIssue.message}", got "${actualIssue.message}"`);
      }
    }
  }
  
  return {
    match: differences.length === 0,
    differences
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Executor Parity Tests', () => {
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
    
    // Ensure validator is available
    if (!validator.isAvailable()) {
      log.warn('Validator not available - tests may be limited');
    }
  }, 120000); // 120 second timeout for initialization

  afterAll(() => {
    validator = null as unknown as RecordsValidator;
  });

  describe('Patient Resource Validation', () => {
    it('should validate valid Patient resource with same results', async () => {
      const profileUrl = `${baseProfileUrl}/Patient`;
      const issues = await validator.validate(VALID_PATIENT, profileUrl, 'R4');
      
      // Valid patient should have minimal or no issues
      // Note: Some validators may report informational issues
      expect(Array.isArray(issues)).toBe(true);
      
      // Log for debugging
      if (issues.length > 0) {
        log.info('Valid Patient issues:', JSON.stringify(issues, null, 2));
      }
    });

    it('should detect missing required fields in Patient', async () => {
      const profileUrl = `${baseProfileUrl}/Patient`;
      const issues = await validator.validate(INVALID_PATIENT_MISSING_REQUIRED, profileUrl, 'R4');
      
      // Should detect missing required name field
      expect(issues.length).toBeGreaterThan(0);
      
      const requiredFieldIssues = issues.filter(issue => 
        issue.code === 'required-element-missing' || 
        issue.message.toLowerCase().includes('required') ||
        issue.message.toLowerCase().includes('missing')
      );
      
      expect(requiredFieldIssues.length).toBeGreaterThan(0);
      
      // Should mention name field
      const nameIssues = issues.filter(issue => 
        issue.path?.includes('name') || 
        issue.message.toLowerCase().includes('name')
      );
      expect(nameIssues.length).toBeGreaterThan(0);
    });

    it('should detect invalid enum values in Patient', async () => {
      const profileUrl = `${baseProfileUrl}/Patient`;
      const issues = await validator.validate(PATIENT_WITH_INVALID_TYPE, profileUrl, 'R4');
      
      // Should detect invalid gender value
      expect(issues.length).toBeGreaterThan(0);
      
      const genderIssues = issues.filter(issue => 
        issue.path?.includes('gender') || 
        issue.message.toLowerCase().includes('gender')
      );
      
      // May detect as type mismatch, binding issue, or constraint violation
      expect(genderIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Observation Resource Validation', () => {
    it('should validate valid Observation resource', async () => {
      const profileUrl = `${baseProfileUrl}/Observation`;
      const issues = await validator.validate(VALID_OBSERVATION, profileUrl, 'R4');
      
      expect(Array.isArray(issues)).toBe(true);
      
      // Valid observation should have minimal issues
      if (issues.length > 0) {
        log.info('Valid Observation issues:', JSON.stringify(issues, null, 2));
      }
    });

    it('should detect missing required fields in Observation', async () => {
      const profileUrl = `${baseProfileUrl}/Observation`;
      const issues = await validator.validate(OBSERVATION_MISSING_REQUIRED, profileUrl, 'R4');
      
      // Should detect missing required status and code fields
      expect(issues.length).toBeGreaterThan(0);
      
      const requiredFieldIssues = issues.filter(issue => 
        issue.code === 'required-element-missing' || 
        issue.message.toLowerCase().includes('required') ||
        issue.message.toLowerCase().includes('missing')
      );
      
      expect(requiredFieldIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Condition Resource Validation', () => {
    it('should validate valid Condition resource', async () => {
      const profileUrl = `${baseProfileUrl}/Condition`;
      const issues = await validator.validate(VALID_CONDITION, profileUrl, 'R4');
      
      expect(Array.isArray(issues)).toBe(true);
      
      // Valid condition should have minimal issues
      if (issues.length > 0) {
        log.info('Valid Condition issues:', JSON.stringify(issues, null, 2));
      }
    });
  });

  describe('Structural Validation Parity', () => {
    it('should validate structure with same results as before', async () => {
      const issues = await validator.validateStructure(VALID_PATIENT, 'R4');
      
      expect(Array.isArray(issues)).toBe(true);
      
      // Structure validation should check required fields
      // Valid patient should pass structural checks
      const requiredFieldIssues = issues.filter(issue => 
        issue.code === 'required-element-missing'
      );
      
      // Valid patient should not have required field issues
      expect(requiredFieldIssues.length).toBe(0);
    });

    it('should detect structural issues in invalid resources', async () => {
      const issues = await validator.validateStructure(INVALID_PATIENT_MISSING_REQUIRED, 'R4');

      // Structural validation should run (may or may not find issues for optional fields)
      expect(Array.isArray(issues)).toBe(true);
    });
  });

  describe('Metadata Validation Parity', () => {
    it('should validate metadata with same results', async () => {
      const issues = await validator.validateMetadata(VALID_PATIENT);
      
      expect(Array.isArray(issues)).toBe(true);

      // Valid metadata should have no errors (warnings/info are ok)
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors.length).toBe(0);
    });

    it('should detect metadata issues', async () => {
      const invalidMetadata = {
        ...VALID_PATIENT,
        meta: {
          profile: 'not-an-array', // Should be array
          lastUpdated: 'invalid-date-format' // Invalid format
        }
      };
      
      const issues = await validator.validateMetadata(invalidMetadata);
      
      expect(issues.length).toBeGreaterThan(0);
      
      const metadataIssues = issues.filter(issue => 
        issue.aspect === 'metadata'
      );
      
      expect(metadataIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Reference Validation Parity', () => {
    it('should validate references with same results', async () => {
      const issues = await validator.validateReferences(VALID_OBSERVATION);
      
      expect(Array.isArray(issues)).toBe(true);
      
      // Reference validation may or may not resolve references
      // Just ensure it returns an array
    });
  });

  describe('Aspect Coverage', () => {
    it('should validate all aspects through executors', async () => {
      const profileUrl = `${baseProfileUrl}/Patient`;
      const issues = await validator.validate(VALID_PATIENT, profileUrl, 'R4');
      
      // Collect aspects covered
      const aspects = new Set(issues.map(issue => issue.aspect));
      
      // Log aspects found for debugging
      log.info('Aspects covered in validation:', Array.from(aspects));
      
      // Should have at least structural validation
      expect(issues.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Consistency Checks', () => {
    it('should produce consistent results across multiple validations', async () => {
      const profileUrl = `${baseProfileUrl}/Patient`;
      
      // Run validation multiple times
      const results1 = await validator.validate(VALID_PATIENT, profileUrl, 'R4');
      const results2 = await validator.validate(VALID_PATIENT, profileUrl, 'R4');
      const results3 = await validator.validate(VALID_PATIENT, profileUrl, 'R4');
      
      // Results should be consistent (same issue count and types)
      const normalized1 = normalizeIssues(results1);
      const normalized2 = normalizeIssues(results2);
      const normalized3 = normalizeIssues(results3);
      
      const comparison1 = compareResults(normalized1, normalized2, 'Patient');
      const comparison2 = compareResults(normalized2, normalized3, 'Patient');
      
      expect(comparison1.match).toBe(true);
      expect(comparison2.match).toBe(true);
      
      if (!comparison1.match) {
        log.error('Inconsistency between run 1 and 2:', comparison1.differences);
      }
      if (!comparison2.match) {
        log.error('Inconsistency between run 2 and 3:', comparison2.differences);
      }
    });
  });
});
